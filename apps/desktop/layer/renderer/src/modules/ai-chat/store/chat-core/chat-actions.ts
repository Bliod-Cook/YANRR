import { autoBindThis } from "@follow/utils/bind-this"
import type { ChatRequestOptions, ChatStatus } from "ai"
import { merge } from "es-toolkit/compat"
import { nanoid } from "nanoid"
import type { StateCreator } from "zustand"

import { AIPersistService } from "../../services"
import { createChatTitleHandler, createChatTransport } from "../transport"
import type { BizUIMessage, SendingUIMessage } from "../types"
import { ZustandChat } from "./chat-instance"
import type { ChatSlice } from "./types"

export class ChatSliceActions {
  // Mounted chat roots, the most recently mounted last. A closed modal or layout removes its
  // own entry, so the previous chat becomes active again instead of a store nobody sees.
  private static _activeStack: ChatSliceActions[] = []

  /**
   * Get the currently active ChatSliceActions instance.
   *
   * WARNING: Anti-pattern — temporary global accessor used. Do NOT use in new code.
   * This may be removed/refactored.
   */
  static getActiveInstance(): ChatSliceActions | null {
    return this._activeStack.at(-1) ?? null
  }

  /**
   * See warning above — this exists solely for the same limited purpose.
   * @returns a function that removes the instance again when its chat root unmounts
   */
  static activate(instance: ChatSliceActions) {
    this._activeStack.push(instance)
    return () => {
      const index = this._activeStack.lastIndexOf(instance)
      if (index !== -1) this._activeStack.splice(index, 1)
    }
  }

  private chatInstance: ZustandChat
  // Bumped by every chat switch or new chat, so a slower earlier switch can tell it is outdated
  private switchToken = 0
  constructor(
    private params: Parameters<StateCreator<ChatSlice, [], [], ChatSlice>>,
    chatId: string,
  ) {
    this.chatInstance = this.createChat(chatId, [])
    return autoBindThis(this)
  }

  get set() {
    return this.params[0]
  }

  get get() {
    return this.params[1]
  }

  // Direct message management methods (delegating to chat instance state)
  setMessages = (
    messagesParam: BizUIMessage[] | ((messages: BizUIMessage[]) => BizUIMessage[]),
  ) => {
    if (typeof messagesParam === "function") {
      this.chatInstance.chatState.messages = messagesParam(this.chatInstance.chatState.messages)
    } else {
      this.chatInstance.chatState.messages = messagesParam
    }
  }

  pushMessage = (message: BizUIMessage) => {
    this.chatInstance.chatState.pushMessage(message)
  }

  popMessage = () => {
    this.chatInstance.chatState.popMessage()
  }

  replaceMessage = (index: number, message: BizUIMessage) => {
    this.chatInstance.chatState.replaceMessage(index, message)
  }

  updateMessage = (id: string, updates: Partial<BizUIMessage>) => {
    const messageIndex = this.chatInstance.chatState.messages.findIndex(
      (msg: BizUIMessage) => msg.id === id,
    )
    if (messageIndex !== -1) {
      const message = this.chatInstance.chatState.messages[messageIndex]
      if (message) {
        const updatedMessage = { ...message, ...updates }
        this.replaceMessage(messageIndex, updatedMessage)
      }
    }
  }

  // Getter
  getChatInstance = (): ZustandChat => {
    return this.chatInstance
  }

  getMessages = (): BizUIMessage[] => {
    return this.chatInstance.chatState.messages
  }

  // Status management (delegating to chat instance state)
  setStatus = (status: ChatStatus) => {
    this.chatInstance.chatState.status = status
  }

  setError = (error: Error | undefined) => {
    this.chatInstance.chatState.error = error
  }

  setStreaming = (streaming: boolean) => {
    this.chatInstance.chatState.status = streaming ? "streaming" : "ready"
  }

  // Title management
  setCurrentTitle = (title: string | undefined) => {
    this.set((state) => ({ ...state, currentTitle: title }))
  }

  getCurrentTitle = (): string | undefined => {
    return this.get().currentTitle
  }

  getCurrentChatId = (): string | null => {
    return this.get().chatId
  }

  /**
   * Name a chat that is still untitled after a reply the way the chat history names it. A reply
   * that brought no generated title, such as a failed one, would otherwise leave "New Chat" in
   * the header while the history lists the chat under its stored title.
   */
  adoptStoredTitle = async (chatId: string) => {
    const isCurrentAndUntitled = () => this.get().chatId === chatId && !this.get().currentTitle
    if (!isCurrentAndUntitled() || this.getMessages().length === 0) return

    try {
      await AIPersistService.ensureSession(chatId)
      const session = await AIPersistService.getChatSession(chatId)
      if (session?.title && isCurrentAndUntitled()) {
        this.setCurrentTitle(session.title)
      }
    } catch (error) {
      console.error("Failed to read the chat title:", error)
    }
  }

  private createChat(chatId: string, messages: BizUIMessage[]) {
    return new ZustandChat(
      {
        id: chatId,
        messages,
        transport: createChatTransport({
          titleHandler: createChatTitleHandler({
            chatId,
            getActiveChatId: () => this.get().chatId,
            onTitleChange: (title) => {
              this.setCurrentTitle(title)
            },
          }),
        }),
      },
      {
        update: this.set,
        onIdle: () => void this.adoptStoredTitle(chatId),
      },
    )
  }

  // Edit chat title
  editChatTitle = async (newTitle: string) => {
    const currentChatId = this.getCurrentChatId()
    if (!currentChatId) {
      throw new Error("No active chat to edit title for")
    }

    const trimmedTitle = newTitle.trim()
    const currentTitle = this.getCurrentTitle()

    // If no changes, return early
    if (trimmedTitle === currentTitle) {
      return
    }

    try {
      // Optimistic update
      this.setCurrentTitle(trimmedTitle)

      // Persist to database
      await AIPersistService.updateSessionTitle(currentChatId, trimmedTitle)
    } catch (error) {
      // Rollback on error
      this.setCurrentTitle(currentTitle)
      console.error("Failed to update chat title:", error)
      throw error
    }
  }

  // Core chat actions using AI SDK AbstractChat methods
  /** With a `messageId`, the message replaces that one and the messages after it */
  sendMessage = async (
    message: string | (SendingUIMessage & { messageId?: string }),
    options?: ChatRequestOptions,
  ) => {
    try {
      // Convert string to message object if needed
      const messageObj =
        typeof message === "string"
          ? ({ parts: [{ type: "text", text: message }] } as Parameters<
              typeof this.chatInstance.sendMessage
            >[0])
          : (message as Parameters<typeof this.chatInstance.sendMessage>[0])

      // Use the AI SDK's sendMessage method
      const finalOptions = merge({ body: { scene: "general" } }, options)

      return await this.chatInstance.sendMessage(messageObj, finalOptions)
    } catch (error) {
      this.setError(error as Error)
      throw error
    }
  }

  regenerate = async ({ messageId, ...options }: { messageId: string } & ChatRequestOptions) => {
    try {
      // Use the AI SDK's regenerate method
      const finalOptions = merge({ body: { scene: "general" } }, options)
      return await this.chatInstance.regenerate({ messageId, ...finalOptions })
    } catch (error) {
      this.setError(error as Error)
      throw error
    }
  }

  stop = () => {
    // Use AI SDK's stop method
    this.chatInstance.stop()
  }

  resumeStream = async () => {
    try {
      // Use AI SDK's resumeStream method
      await this.chatInstance.resumeStream()
    } catch (error) {
      this.setError(error as Error)
      throw error
    }
  }

  newChat = async () => {
    this.switchToken++
    const newChatId = nanoid()
    // Cleanup old chat instance
    await this.chatInstance.destroy()

    const newChatInstance = this.createChat(newChatId, [])

    // Update store state
    this.set((state) => ({
      ...state,
      chatId: newChatId,
      messages: [],
      status: "ready" as ChatStatus,
      error: undefined,
      isStreaming: false,
      currentTitle: undefined,
      chatInstance: newChatInstance,
    }))

    // Update the reference
    this.chatInstance = newChatInstance
  }

  switchToChat = async (chatId: string) => {
    const token = ++this.switchToken
    const isOutdated = () => token !== this.switchToken
    try {
      // Cleanup old chat instance
      await this.chatInstance.destroy()
      if (isOutdated()) return
      // Set loading state (using ready as there's no loading status in ChatStatus)
      this.setStatus("ready")
      this.setError(undefined)

      // Load session and messages in parallel to reduce database queries
      const { session: chatSession, messages } =
        await AIPersistService.loadSessionWithMessages(chatId)
      if (isOutdated()) return

      const newChatInstance = this.createChat(chatId, messages)

      // Update store state
      this.set((state) => ({
        ...state,
        chatId,
        messages: [...messages],
        status: "ready" as ChatStatus,
        error: undefined,
        isStreaming: false,
        currentTitle: chatSession?.title || undefined,
        chatInstance: newChatInstance,
      }))

      // Take over before resuming: resumeStream only settles when the resumed answer has
      // finished, and stop, send or newChat must reach this instance meanwhile
      this.chatInstance = newChatInstance
      newChatInstance.resumeStream().catch((error) => {
        console.error("Failed to resume the chat stream:", error)
      })
    } catch (error) {
      if (isOutdated()) return
      console.error("Failed to switch to chat:", error)
      this.setError(error as Error)
      this.setStatus("ready")
      throw error
    }
  }
}
