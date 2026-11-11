import type { ChatState, ChatStatus, ReasoningUIPart, TextUIPart } from "ai"
import { throttle } from "es-toolkit/compat"

import { AIPersistService } from "../../services"
import type { BizUIMessage, BizUIMessagePart, SendingUIMessage } from "../types"
import type { ChatSlice } from "./types"

export interface ChatStateStore {
  update: (updater: (state: ChatSlice) => ChatSlice) => void
  /** Called whenever the chat becomes ready or fails, such as at the end of a reply */
  onIdle: () => void
}

// While a reply streams, the store and so the rendered chat follow it at most this often
const STREAMING_SYNC_INTERVAL = 50

const isStreamingPart = (part: BizUIMessagePart): part is TextUIPart | ReasoningUIPart =>
  "state" in part && part.state === "streaming"

// A part in one of these states is final: the AI SDK no longer changes it
const isFinishedPart = (part: BizUIMessagePart) => {
  if (!("state" in part)) return false
  switch (part.state) {
    case "done":
    case "output-error":
    case "output-denied": {
      return true
    }
    case "output-available": {
      return !("preliminary" in part && part.preliminary)
    }
    default: {
      return false
    }
  }
}

// Zustand Chat State that implements AI SDK ChatState interface
export class ZustandChatState implements ChatState<BizUIMessage> {
  #messages: BizUIMessage[]
  #status: ChatStatus = "ready"
  #error: Error | undefined
  #isResumingStream = false
  #isDestroyed = false
  // The snapshot of each finished part the AI SDK streamed, by the part it keeps changing in place
  #finishedPartSnapshots = new WeakMap<BizUIMessagePart, BizUIMessagePart>()

  constructor(
    initialMessages: BizUIMessage[],
    private store: ChatStateStore,
    private chatId: string,
  ) {
    this.#messages = initialMessages
  }

  //// AI SDK ChatState abstract override methods or properties
  get status(): ChatStatus {
    return this.#status
  }

  set status(newStatus: ChatStatus) {
    if (this.#status === newStatus) return

    const streamEnded = this.#status === "streaming"
    this.#status = newStatus

    // A reply that was stopped or failed keeps its last part streaming; it ends here
    if (streamEnded) {
      this.messages = this.#messages.map((message, index) =>
        index === this.#messages.length - 1 && message.parts.some(isStreamingPart)
          ? {
              ...message,
              parts: message.parts.map((part) =>
                isStreamingPart(part) ? { ...part, state: "done" as const } : part,
              ),
            }
          : message,
      )
    }

    this.#syncStatus(newStatus)
  }

  get error(): Error | undefined {
    return this.#error
  }

  set error(newError: Error | undefined) {
    if (this.#error === newError) return

    this.#error = newError
    if (!this.#isDestroyed) {
      this.store.update((state) => ({ ...state, error: newError }))
    }
  }

  get messages(): BizUIMessage[] {
    return this.#messages
  }

  set messages(newMessages: BizUIMessage[]) {
    this.#messages = [...newMessages]

    // Every chunk of a reply replaces its message, so it is synced at intervals and saved once
    // the reply ends
    if (this.#status === "streaming") {
      this.#syncMessagesWhileStreaming()
      return
    }
    this.#syncMessagesWhileStreaming.cancel()
    this.#syncMessages()
    this.#persistMessages()
  }

  pushMessage = (message: SendingUIMessage) => {
    this.messages = this.#messages.concat(this.#snapshotMessage(message))
  }

  popMessage = () => {
    if (this.#messages.length === 0) return

    this.messages = this.#messages.slice(0, -1)
  }

  replaceMessage = (index: number, message: BizUIMessage) => {
    if (index < 0 || index >= this.#messages.length) return

    this.messages = [
      ...this.#messages.slice(0, index),
      this.#snapshotMessage(message),
      ...this.#messages.slice(index + 1),
    ]
  }

  snapshot = <T>(value: T): T => structuredClone(value)
  //// AI SDK ChatState abstract override methods or properties
  //// END

  /**
   * A copy of a message the AI SDK may still change in place. Finished parts keep the copy made
   * before, so the components showing them don't render again for every chunk.
   */
  #snapshotMessage(message: SendingUIMessage | BizUIMessage): BizUIMessage {
    const { parts, ...rest } = this.#fillMessageCreatedAt(message)
    return {
      ...structuredClone(rest),
      parts: parts.map((part) => {
        const finished = this.#finishedPartSnapshots.get(part)
        if (finished) return finished

        const snapshot = structuredClone(part)
        if (isFinishedPart(part)) this.#finishedPartSnapshots.set(part, snapshot)
        return snapshot
      }),
    }
  }

  #syncMessages = () => {
    if (this.#isDestroyed) return
    const messages = this.#messages
    this.store.update((state) => ({ ...state, messages }))
  }

  #syncMessagesWhileStreaming = throttle(this.#syncMessages, STREAMING_SYNC_INTERVAL)

  #syncStatus(status: ChatStatus) {
    if (this.#isDestroyed) return
    // Suppress the transient "submitted" status emitted when resumeStream probes for an active stream.
    if (this.#isResumingStream && status === "submitted") return
    if (status === "ready" || status === "streaming" || status === "error") {
      this.#isResumingStream = false
    }

    this.store.update((state) => ({ ...state, status, isStreaming: status === "streaming" }))
    if (status === "ready" || status === "error") {
      this.store.onIdle()
    }
  }

  #persistMessages = throttle(
    async () => {
      // A chat is only stored once it has messages
      if (this.#messages.length === 0) return

      try {
        await AIPersistService.saveMessages(this.chatId, this.#messages)
      } catch (error) {
        console.error("Failed to persist messages:", error)
      }
    },
    100,
    { leading: false, trailing: true },
  )

  #fillMessageCreatedAt(message: SendingUIMessage | BizUIMessage): BizUIMessage {
    // The AI SDK keeps streaming into this object, so the time stays on it for later chunks
    const nextMessage = message as BizUIMessage

    if (nextMessage.createdAt) return nextMessage
    if (
      nextMessage.role === "assistant" &&
      nextMessage.metadata?.finishTime &&
      nextMessage.metadata?.duration
    ) {
      nextMessage.createdAt = new Date(
        new Date(nextMessage.metadata.finishTime).getTime() - nextMessage.metadata.duration,
      )
    } else {
      nextMessage.createdAt = new Date()
    }

    return nextMessage
  }

  destroy(): void {
    this.#syncMessagesWhileStreaming.cancel()
    this.#isDestroyed = true
  }

  setResumingStream(isResuming: boolean) {
    this.#isResumingStream = isResuming
  }
}
