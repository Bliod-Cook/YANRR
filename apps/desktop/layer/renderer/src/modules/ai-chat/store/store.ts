import { createWithEqualityFn } from "zustand/traditional"

import type { ChatSlice } from "./chat-core/types"
import type { BlockSlice } from "./slices/block.slice"
import { createBlockSlice } from "./slices/block.slice"
import { createChatSlice } from "./slices/chat.slice"

export type AiChatStore = BlockSlice & ChatSlice

export const createAIChatStore = () => {
  return createWithEqualityFn<AiChatStore>((...a) => ({
    ...createBlockSlice()(...a),
    ...createChatSlice()(...a),
  }))
}
