import { env } from "@follow/shared/env.desktop"
import type { HttpChatTransportInitOptions, UIMessageChunk } from "ai"
import { HttpChatTransport, parseJsonEventStream, uiMessageChunkSchema } from "ai"
import { t } from "i18next"

import { getAIModelState } from "../atoms/session"
import { AIPersistService } from "../services"
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

// A reply that sends nothing for this long has lost its connection: the server sends a chunk, or
// ends the reply with an error, well within it
const CHAT_STREAM_INACTIVITY_TIMEOUT = 5 * 60_000

/**
 * The transport of a chat. It is the one place the requests of a chat are made: sending,
 * regenerating and resuming a reply all reach the API under this URL, with the session cookie.
 */
export function createChatTransport({ titleHandler }: CreateChatTransportOptions) {
  return new ExtendChatTransport({
    titleHandler,
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

    // Ends a reply whose connection died, which would otherwise stay on "Thinking..." until the
    // user stops it
    return withInactivityTimeout(
      chunks,
      CHAT_STREAM_INACTIVITY_TIMEOUT,
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
