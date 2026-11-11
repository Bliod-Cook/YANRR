import type { FeedViewType } from "@follow/constants"
import type { FlashListRef } from "@shopify/flash-list"

import type { TimelineEntries } from "../screen/timeline-entries"

export type EntryExtraData = {
  entryIds: string[] | null
}

/** What each view's list of entries is given */
export type EntryListContentProps = {
  ref?: React.Ref<FlashListRef<string> | null>
  entries: TimelineEntries
  active?: boolean
  view: FeedViewType
  onResetScrollSignalConsumed?: (signal: number) => void
  resetScrollSignal?: number
  suspendMarkRead?: boolean
}
