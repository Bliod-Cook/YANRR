import { autoBindThis } from "@follow/utils/bind-this"
import { produce } from "immer"
import { nanoid } from "nanoid"
import type { StateCreator } from "zustand"

import type { AIChatContextBlock, AIChatContextBlockInput, FileAttachment } from "../types"

export interface BlockSlice {
  blocks: AIChatContextBlock[]
  blockActions: BlockSliceAction
}

export const createBlockSlice: () => StateCreator<BlockSlice, [], [], BlockSlice> =
  () =>
  (...params) => {
    return {
      blocks: [],
      blockActions: new BlockSliceAction(params),
    }
  }

export class BlockSliceAction {
  constructor(private params: Parameters<StateCreator<BlockSlice, [], [], BlockSlice>>) {
    return autoBindThis(this)
  }

  static SPECIAL_TYPES = {
    mainView: "mainView",
    mainEntry: "mainEntry",
    mainFeed: "mainFeed",
    unreadOnly: "unreadOnly",
  }
  get set() {
    return this.params[0]
  }

  get get() {
    return this.params[1]
  }
  addBlock(block: AIChatContextBlockInput & { id?: string }) {
    const currentBlocks = this.get().blocks

    // Only allow one SPECIAL_TYPES
    if (
      Object.values(BlockSliceAction.SPECIAL_TYPES).includes(block.type) &&
      currentBlocks.some((b) => b.type === block.type)
    ) {
      return
    }

    this.set(
      produce((state: BlockSlice) => {
        // File attachments keep their attachment id: removing or updating an attachment looks
        // its block up by that id
        state.blocks.push({
          ...block,
          id: BlockSliceAction.SPECIAL_TYPES[block.type] || block.id || nanoid(8),
        })
      }),
    )
  }

  removeBlock(id: string) {
    this.set(
      produce((state: BlockSlice) => {
        state.blocks = state.blocks.filter((block) => block.id !== id)
      }),
    )
  }

  toggleBlockDisabled(id: string, disabled?: boolean) {
    this.set(
      produce((state: BlockSlice) => {
        const block = state.blocks.find((block) => block.id === id)
        if (block) {
          const nextDisabled = disabled ?? !block.disabled

          if (!nextDisabled) {
            delete block.disabled
          } else {
            block.disabled = true
          }
        }
      }),
    )
  }
  updateBlock(id: string, updates: Partial<AIChatContextBlock>) {
    this.set(
      produce((state: BlockSlice) => {
        state.blocks = state.blocks.map((block) => {
          if (block.id !== id) return block

          // Handle discriminated union updates carefully
          if (updates.type && updates.type !== block.type) {
            // Type change - need to replace the entire block
            return { ...updates, id } as AIChatContextBlock
          } else {
            // Same type - safe to spread
            return { ...block, ...updates } as AIChatContextBlock
          }
        })
      }),
    )
  }

  addOrUpdateBlock(block: AIChatContextBlock) {
    const isExist = this.get().blocks.some((b) => b.id === block.id)
    if (isExist) {
      this.updateBlock(block.id, block)
    } else {
      this.addBlock(block)
    }
  }

  clearBlocks({ keepSpecialTypes = false }: { keepSpecialTypes?: boolean } = {}) {
    this.set(
      produce((state: BlockSlice) => {
        state.blocks = keepSpecialTypes
          ? state.blocks.filter((b) =>
              Object.values(BlockSliceAction.SPECIAL_TYPES).includes(b.type),
            )
          : []
      }),
    )
  }

  resetContext() {
    this.set(
      produce((state: BlockSlice) => {
        state.blocks = []
      }),
    )
  }

  getBlocks() {
    return this.get().blocks
  }

  // File attachment specific methods
  addFileAttachment(fileAttachment: FileAttachment) {
    const fileBlock: AIChatContextBlock = {
      id: fileAttachment.id,
      type: "fileAttachment",
      attachment: fileAttachment,
    }
    this.addBlock(fileBlock)
  }

  updateFileAttachment(attachmentId: string, updatedAttachment: FileAttachment) {
    this.set(
      produce((state: BlockSlice) => {
        const block = state.blocks.find(
          (b) => b.type === "fileAttachment" && b.attachment.id === attachmentId,
        )
        if (block && block.type === "fileAttachment") {
          block.attachment = updatedAttachment
        }
      }),
    )
  }

  removeFileAttachment(fileId: string) {
    this.removeBlock(fileId)
  }
}
