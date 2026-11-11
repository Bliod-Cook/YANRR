import type { FeedViewType } from "@follow/constants"

/**
 * Shared props interface for all entry content layout components
 */
export interface EntryLayoutProps {
  entryId: string
  view: FeedViewType
  compact?: boolean
  noMedia?: boolean
}
