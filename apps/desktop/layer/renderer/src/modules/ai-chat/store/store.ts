import { createWithEqualityFn } from "zustand/traditional"

import type { ChatSlice } from "./chat-core/types"
import type { BlockSlice } from "./slices/block.slice"
import { createBlockSlice } from "./slices/block.slice"
import { createChatSlice } from "./slices/chat.slice"

export type AiChatStore = BlockSlice &
  ChatSlice & {
    reset: () => void
  }

export const createAIChatStore = () => {
  return createWithEqualityFn<AiChatStore>((...a) => {
    const blockSlice = createBlockSlice()(...a)
    const chatSlice = createChatSlice()(...a)

    return {
      ...blockSlice,
      ...chatSlice,

      reset: () => {
        blockSlice.blockActions.resetContext()
        chatSlice.chatActions.resetChat()
      },
    }
  })
}
