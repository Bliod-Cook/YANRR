import { nanoid } from "nanoid"
import type { StateCreator } from "zustand"

import { ChatSliceActions } from "../chat-core/chat-actions"
import { ZustandChat } from "../chat-core/chat-instance"
import type { ChatSlice } from "../chat-core/types"
import { createChatTitleHandler, createChatTransport } from "../transport"

export const createChatSlice: () => StateCreator<ChatSlice, [], [], ChatSlice> =
  () =>
  (...params) => {
    const [set, get] = params

    const chatId = nanoid()
    const chatInstance = new ZustandChat(
      {
        id: chatId,
        messages: [],
        transport: createChatTransport({
          titleHandler: createChatTitleHandler({
            chatId,
            getActiveChatId: () => get().chatId,
            onTitleChange: (title) => {
              set({
                currentTitle: title,
              })
            },
          }),
        }),
      },
      set,
    )

    const chatActions = new ChatSliceActions(params, chatInstance)

    return {
      chatId,
      messages: [],
      status: "ready",
      error: undefined,
      isStreaming: false,
      currentTitle: undefined,
      chatInstance,
      chatActions,
    }
  }
