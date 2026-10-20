import type { FeedViewType } from "@follow/constants"

export type FeedListProps = {
  view: FeedViewType
  data: Record<string, string[]>
  categoryOpenStateData: Record<string, boolean>
}
export type SortBy = "count" | "alphabetical"

export type InboxListProps = {
  view: FeedViewType
  data: string[]
}
