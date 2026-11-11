import type { FeedViewType } from "@follow/constants"
import type { EntrySchema } from "@follow/database/schemas/types"

export type EntryModel = EntrySchema
export type EntrySortOrder = "asc" | "desc"
/** Where the next page starts: the time the list is sorted by and the id of its last entry */
export type EntriesPageParam = { time: string; id: string }
export type FetchEntriesProps = {
  feedId?: string
  feedIdList?: string[]
  inboxId?: string
  view?: number
  read?: boolean
  limit?: number
  pageParam?: EntriesPageParam
  isCollection?: boolean
  aiSort?: boolean
  sortOrder?: EntrySortOrder
}

export type FetchEntriesPropsSettings = {
  unreadOnly?: boolean
  sortOrder?: EntrySortOrder
}

export type UseEntriesProps = {
  viewId?: FeedViewType
  active?: boolean
}

export type UseEntriesReturn = {
  entriesIds: string[]
  hasNext: boolean
  refetch: () => Promise<void>
  fetchNextPage: () => Promise<void> | void
  isLoading: boolean
  isRefetching: boolean
  isReady: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  error: Error | null
  /** Marking the list read up to its end covers what was inserted before this */
  insertedBefore?: number
  queryKey?: (string | number | boolean | string[] | undefined)[]
}

export type UseEntriesControl = Pick<
  UseEntriesReturn,
  "fetchNextPage" | "isFetching" | "refetch" | "isRefetching" | "hasNextPage"
>
