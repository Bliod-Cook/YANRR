import { nanoid } from "nanoid"
import type { StateCreator } from "zustand"

import { ChatSliceActions } from "../chat-core/chat-actions"
import type { ChatSlice } from "../chat-core/types"

export const createChatSlice: () => StateCreator<ChatSlice, [], [], ChatSlice> =
  () =>
  (...params) => {
    const chatId = nanoid()
    const chatActions = new ChatSliceActions(params, chatId)

    return {
      chatId,
      messages: [],
      status: "ready",
      error: undefined,
      isStreaming: false,
      currentTitle: undefined,
      chatInstance: chatActions.getChatInstance(),
      chatActions,
    }
  }
