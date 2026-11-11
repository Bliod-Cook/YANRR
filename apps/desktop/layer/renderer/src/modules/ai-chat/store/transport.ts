import { env } from "@follow/shared/env.desktop"
import type { HttpChatTransportInitOptions, UIMessageChunk } from "ai"
import { HttpChatTransport, parseJsonEventStream, uiMessageChunkSchema } from "ai"
import { t } from "i18next"

import { getAIModelState } from "../atoms/session"
import { AIPersistService } from "../services"
import { createChatStreamTimeout } from "../utils/chat-stream-timeout"
import { withInactivityTimeout } from "../utils/stream-timeout"
import type { BizUIMessage } from "./types"

export interface TitleHandlerOptions {
  chatId: string
  shouldHandle: () => boolean
  onTitleChange: (title: string) => void
}

export interface CreateChatTransportOptions {
  titleHandler: TitleHandlerOptions
}

export interface CreateChatTitleHandlerOptions {
  chatId: string
  getActiveChatId: () => string | null | undefined
  onTitleChange: (title: string) => void
}

export function createChatTitleHandler(
  options: CreateChatTitleHandlerOptions,
): TitleHandlerOptions {
  const { chatId, getActiveChatId, onTitleChange } = options

  return {
    chatId,
    onTitleChange,
    shouldHandle: () => getActiveChatId() === chatId,
  }
}

/**
 * Create a chat transport for AI SDK
 * This is used by the AbstractChat instance to communicate with AI providers
 */
export function createChatTransport({ titleHandler }: CreateChatTransportOptions) {
  return new ExtendChatTransport({
    titleHandler,
    // Custom fetch configuration
    api: `${env.VITE_API_URL}/ai/chat`,
    credentials: "include",
    // Add selected model to request body
    body: () => {
      const modelState = getAIModelState()
      const { selectedModel } = modelState

      return selectedModel ? { model: selectedModel } : {}
    },
  })
}

type UIMessageChunkParseResult =
  ReturnType<typeof parseJsonEventStream<UIMessageChunk>> extends ReadableStream<infer T>
    ? T
    : never

class ExtendChatTransport extends HttpChatTransport<BizUIMessage> {
  constructor(
    private options: HttpChatTransportInitOptions<BizUIMessage> & {
      titleHandler: TitleHandlerOptions
    },
  ) {
    super(options)
  }

  protected processResponseStream(
    stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  ): ReadableStream<UIMessageChunk> {
    const handleGeneratedTitle = this.handleGeneratedTitle.bind(this)
    const chunks = parseJsonEventStream({
      stream,
      schema: uiMessageChunkSchema,
    }).pipeThrough(
      new TransformStream<UIMessageChunkParseResult, UIMessageChunk>({
        async transform(chunk, controller) {
          if (!chunk.success) {
            throw chunk.error
          }

          await handleGeneratedTitle(chunk.value)
          controller.enqueue(chunk.value)
        },
      }),
    )

    // The server ends a stalled reply with an error chunk that says why; this only ends a reply
    // whose connection died, which would otherwise stay on "Thinking..." until the user stops it.
    return withInactivityTimeout(
      chunks,
      createChatStreamTimeout(),
      () => new Error(t("chat.error.stream_timeout", { ns: "ai" })),
    )
  }

  private async handleGeneratedTitle(chunk: UIMessageChunk) {
    const { titleHandler } = this.options

    if (chunk.type !== "data-generated-title" || typeof chunk.data !== "string") {
      return
    }

    if (!titleHandler.shouldHandle()) {
      return
    }

    titleHandler.onTitleChange(chunk.data)

    try {
      await AIPersistService.updateSessionTitle(titleHandler.chatId, chunk.data)
    } catch (error) {
      console.error("Failed to persist generated title:", error)
    }
  }

  override reconnectToStream(
    options: Parameters<HttpChatTransport<BizUIMessage>["reconnectToStream"]>[0],
  ) {
    options.chatId = encodeURIComponent(options.chatId)
    return super.reconnectToStream(options)
  }
}
