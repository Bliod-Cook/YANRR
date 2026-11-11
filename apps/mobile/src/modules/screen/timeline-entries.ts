import type { useEntriesQuery } from "@follow/store/entry/hooks"
import type { UseEntriesReturn } from "@follow/store/entry/types"
import { fallbackReturn } from "@follow/store/entry/utils"

/** What a list of entries shows, from the server or from the entries stored on the device */
export type TimelineEntries = UseEntriesReturn & {
  /** The request `error` tells of asked for the next page, not for the first one */
  isFetchNextPageError?: boolean
}

export type RemoteTimelineEntries = TimelineEntries & {
  /** Fetches the first page again and tells the user when that fails */
  refetchReportingFailure: () => Promise<void>
}

type EntriesQuery = Pick<
  ReturnType<typeof useEntriesQuery>,
  | "entriesIds"
  | "error"
  | "hasNextPage"
  | "insertedBefore"
  | "isError"
  | "isFetchNextPageError"
  | "isFetching"
  | "isFetchingNextPage"
  | "isRefetching"
> & { data: unknown }

type RemoteActions = Pick<
  RemoteTimelineEntries,
  "fetchNextPage" | "refetch" | "refetchReportingFailure"
>

/**
 * The server's list as the timeline reads it. It is ready once a page is in, and stays when a
 * later request fails, which `error` tells of. After a failed page, paging waits until that page
 * is asked for again.
 */
export const getRemoteTimelineEntries = (
  query: EntriesQuery,
  actions: RemoteActions,
): RemoteTimelineEntries => {
  if (query.data === undefined) {
    // Without data yet, still report a failed first page and keep the remote refetch, so the
    // timeline can fall back to the stored entries and pull to refresh tries the server again
    return {
      ...fallbackReturn,
      ...actions,
      isLoading: !query.isError,
      isRefetching: query.isRefetching,
      isFetching: query.isFetching,
      error: query.error,
    }
  }

  const hasNextPage = query.hasNextPage && !query.isFetchNextPageError
  return {
    ...actions,
    entriesIds: query.entriesIds,
    hasNext: hasNextPage,
    isLoading: query.isFetching,
    isRefetching: query.isRefetching,
    isReady: true,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetching: query.isFetching,
    hasNextPage,
    error: query.error,
    isFetchNextPageError: query.isFetchNextPageError,
    insertedBefore: query.insertedBefore,
  }
}

/**
 * Runs `refresh` unless one is under way, which the call joins instead. A pull while the first page
 * still loads joins that request, which the list shows no spinner for, so each further pull would
 * otherwise tell the same failure once more.
 */
export const joinRefreshAttempt = (
  attempt: { current: Promise<void> | null },
  refresh: () => Promise<void>,
): Promise<void> => {
  attempt.current ??= refresh().finally(() => {
    attempt.current = null
  })
  return attempt.current
}

/**
 * Pulling to refresh keeps the entries on screen as they were when it fails, which alone would
 * not say that it failed. An empty list says why itself.
 */
const reportFailedRefresh = (
  shown: TimelineEntries,
  remote: RemoteTimelineEntries,
): TimelineEntries =>
  shown.entriesIds.length > 0 ? { ...shown, refetch: remote.refetchReportingFailure } : shown

/**
 * What a list of entries shows, on Home or for a feed, category, inbox or the starred entries. The
 * server's first page wins once it is in. Until then the entries stored on the device show, as
 * they do when that page fails: a request can take until it times out, and a refresh after a
 * failed one starts over without its error, so waiting for either would hide them behind
 * placeholders. Without stored entries the placeholders show, until a failure ends them.
 */
export const pickTimelineEntries = (
  remote: RemoteTimelineEntries,
  local: UseEntriesReturn,
): TimelineEntries => {
  if (remote.isReady) {
    return reportFailedRefresh(remote, remote)
  }

  if (remote.error || local.entriesIds.length > 0) {
    return reportFailedRefresh(
      {
        ...local,
        // Pulling to refresh retries the server rather than the stored entries
        refetch: remote.refetch,
        isFetching: remote.isFetching,
        isRefetching: remote.isRefetching,
        error: remote.error,
        isReady: true,
      },
      remote,
    )
  }

  return {
    ...fallbackReturn,
    refetch: remote.refetch,
    fetchNextPage: remote.fetchNextPage,
    isLoading: remote.isLoading,
    isFetching: remote.isFetching,
    isRefetching: remote.isRefetching,
  }
}
