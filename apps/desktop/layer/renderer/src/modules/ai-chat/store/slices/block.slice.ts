import { getCategoryFeedIds } from "@follow/store/subscription/getter"
import { autoBindThis } from "@follow/utils/bind-this"
import type { StateCreator } from "zustand"

import { getGeneralSettings } from "~/atoms/settings/general"
import { ROUTE_FEED_IN_FOLDER } from "~/constants"
import { getRouteParams } from "~/hooks/biz/useRouteParams"

import { getRouteContext } from "../route-context"
import type { AIChatContextBlock, FileAttachment, FileAttachmentContextBlock } from "../types"

export interface BlockSlice {
  /** The files attached to the next message */
  blocks: FileAttachmentContextBlock[]
  /** The route context the user left out of their messages, by its key */
  excludedContextKey: string | undefined
  blockActions: BlockSliceAction
}

export const createBlockSlice: () => StateCreator<BlockSlice, [], [], BlockSlice> =
  () =>
  (...params) => {
    return {
      blocks: [],
      excludedContextKey: undefined,
      blockActions: new BlockSliceAction(params),
    }
  }

export class BlockSliceAction {
  constructor(private params: Parameters<StateCreator<BlockSlice, [], [], BlockSlice>>) {
    return autoBindThis(this)
  }

  get set() {
    return this.params[0]
  }

  get get() {
    return this.params[1]
  }

  getBlocks() {
    return this.get().blocks
  }

  setContextExcluded(key: string, excluded: boolean) {
    this.set({ excludedContextKey: excluded ? key : undefined })
  }

  /**
   * The context of the message being sent: what the user is looking at now unless they left it
   * out, and the uploaded files, which go with this message only.
   */
  takeMessageContext(): AIChatContextBlock[] {
    const route = getRouteParams()
    const routeContext = getRouteContext(route, getGeneralSettings().unreadOnly)
    const context: AIChatContextBlock[] = []

    if (routeContext && routeContext.key !== this.get().excludedContextKey) {
      for (const block of routeContext.blocks) {
        const folder =
          block.type === "mainFeed" && block.value.startsWith(ROUTE_FEED_IN_FOLDER)
            ? block.value.slice(ROUTE_FEED_IN_FOLDER.length)
            : undefined
        // A folder is sent as the feeds in it
        context.push(
          folder === undefined
            ? block
            : { ...block, value: getCategoryFeedIds(folder, route.view).join(",") },
        )
      }
    }

    for (const block of this.get().blocks) {
      // A file that failed or has not finished uploading has nothing for the model to read
      if (!block.attachment.serverUrl) continue
      const { id, name, type, size, serverUrl } = block.attachment
      context.push({ ...block, attachment: { id, name, type, size, serverUrl } })
    }

    this.clearFileAttachments()
    return context
  }

  addFileAttachment(attachment: FileAttachment) {
    // The block keeps the attachment id: removing or updating an attachment looks it up by that id
    this.set({
      blocks: [...this.get().blocks, { id: attachment.id, type: "fileAttachment", attachment }],
    })
  }

  updateFileAttachment(attachmentId: string, attachment: FileAttachment) {
    this.set({
      blocks: this.get().blocks.map((block) =>
        block.attachment.id === attachmentId ? { ...block, attachment } : block,
      ),
    })
  }

  removeFileAttachment(attachmentId: string) {
    this.set({ blocks: this.get().blocks.filter((block) => block.id !== attachmentId) })
  }

  clearFileAttachments() {
    this.set({ blocks: [] })
  }
}
