import type { FeedViewType } from "@follow/constants"
import type { InfiniteData, Query, QueryKey } from "@tanstack/react-query"
import {
  infiniteQueryOptions,
  isCancelledError,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useEffect, useMemo } from "react"

import { FEED_COLLECTION_LIST } from "../../constants/app"
import { queryClient } from "../../context"
import { useFeedUnreadIsDirty } from "../feed/hooks"
import { useSyncUnreadWhenUnMatch } from "../unread/hooks"
import type { UnreadListScope } from "../unread/types"
import {
  getEntryIdsByFeedIdSelector,
  getEntryIdsByFeedIdsSelector,
  getEntryIdsByInboxIdSelector,
  getEntryIdsByViewSelector,
  getEntryIsInboxSelector,
  getHasEntrySelector,
} from "./getter"
import { fetchNextPageAfterRefetch } from "./next-page"
import { entrySyncServices, useEntryStore } from "./store"
import type {
  EntriesPageParam,
  EntryModel,
  FetchEntriesProps,
  FetchEntriesPropsSettings,
} from "./types"
import {
  ENTRIES_PAGE_SIZE,
  getEffectiveEntrySortOrder,
  isTimelineEntriesSource,
  markPageEnd,
  mergeEntriesHead,
  trimTrailingEmptyPages,
} from "./utils"

/**
 * Marks entry lists as out of date. A list fetches its first page again when it is entered next
 * (see `useEntriesQuery`); with `refetch`, the lists on screen are fetched again right away.
 */
export const invalidateEntriesQuery = async ({
  views,
  collection,
  refetch = true,
}: {
  views?: FeedViewType[]
  collection?: true
  refetch?: boolean
}) => {
  const predicate = (query: Query) => {
    const { queryKey } = query
    if (Array.isArray(queryKey) && queryKey[0] === "entries") {
      const feedId = queryKey[1]
      const view = queryKey[3]

      const isCollection = queryKey[6]
      if (views) {
        return views.includes(view as FeedViewType)
      }

      if (collection) {
        return isCollection === true || feedId === FEED_COLLECTION_LIST
      }
    }
    return false
  }
  const client = queryClient()
  await client.invalidateQueries({ predicate, refetchType: "none" })
  if (!refetch) return
  // TanStack does not refetch lists with a static `staleTime`, so they are fetched here
  const active = client.getQueryCache().findAll({ predicate, type: "active" })
  await Promise.all(active.map((query) => query.fetch().catch(() => {})))
}

type EntriesPage = Awaited<ReturnType<typeof entrySyncServices.fetchEntries>> & {
  isEnd?: boolean
}
type EntriesQueryData = InfiniteData<EntriesPage, EntriesPageParam | undefined>

const readEntriesQueryKey = (queryKey: QueryKey) => {
  const [, feedId, inboxId, view, limit, feedIdList, isCollection, unreadOnly, aiSort, sortOrder] =
    queryKey as [
      string,
      FetchEntriesProps["feedId"],
      FetchEntriesProps["inboxId"],
      FetchEntriesProps["view"],
      FetchEntriesProps["limit"],
      FetchEntriesProps["feedIdList"],
      FetchEntriesProps["isCollection"],
      boolean | undefined,
      boolean | undefined,
      FetchEntriesProps["sortOrder"],
    ]
  return {
    feedId,
    inboxId,
    view,
    limit,
    feedIdList,
    isCollection,
    unreadOnly,
    aiSort,
    sortOrder,
  }
}

type EntriesQueryParams = ReturnType<typeof readEntriesQueryKey>

/** A page of the list the params stand for, starting at `pageParam` */
const fetchEntriesPage = async (
  params: EntriesQueryParams,
  pageParam: EntriesPageParam | undefined,
): Promise<EntriesPage> => {
  const limit = params.aiSort ? 100 : params.limit
  return markPageEnd(
    await entrySyncServices.fetchEntries({
      feedId: params.feedId,
      inboxId: params.inboxId,
      view: params.view,
      limit,
      feedIdList: params.feedIdList,
      isCollection: params.isCollection,
      aiSort: params.aiSort,
      read: params.unreadOnly ? false : undefined,
      sortOrder: params.sortOrder,
      pageParam,
    }),
    limit ?? ENTRIES_PAGE_SIZE,
  )
}

/** Where the page after `lastEntry` starts; collections page by when entries were collected */
const pageParamAfter = (
  lastEntry: NonNullable<EntriesPage["data"]>[number] | undefined,
  isCollectionQuery: boolean,
): EntriesPageParam | undefined => {
  const time = isCollectionQuery
    ? (toCursorTime(lastEntry?.collections?.createdAt) ??
      toCursorTime(lastEntry?.entries.publishedAt))
    : toCursorTime(lastEntry?.entries.publishedAt)
  // The id places the cursor among the entries of its time
  return lastEntry && time ? { time, id: lastEntry.entries.id } : undefined
}

/** The list `queryKey` stands for: the key holds everything its requests are made of */
const entriesQueryOptions = (queryKey: QueryKey) => {
  const params = readEntriesQueryKey(queryKey)
  const isCollectionQuery = params.isCollection === true || params.feedId === FEED_COLLECTION_LIST
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam }) => fetchEntriesPage(params, pageParam),
    getNextPageParam: (lastPage) => {
      if (params.aiSort || lastPage.isEnd) return
      return pageParamAfter(lastPage.data?.at(-1), isCollectionQuery)
    },
    initialPageParam: undefined as EntriesPageParam | undefined,
  })
}

/**
 * An oldest-first list receives new entries at its end. When it was read to its end, the
 * entries after its last one are fetched and added as a page. A list that still has pages to
 * load picks the new entries up when the user gets there.
 */
const refreshEntriesTail = async (query: Query, params: EntriesQueryParams) => {
  const loaded = query.state.data as EntriesQueryData | undefined
  if (!loaded?.pages.at(-1)?.isEnd) return
  // The empty page a full last page was followed by goes, the new entries take its place
  const current = trimTrailingEmptyPages(loaded)!

  const pageParam = pageParamAfter(current.pages.at(-1)?.data?.at(-1), false)
  if (!pageParam) return
  const page = await fetchEntriesPage(params, pageParam)
  if (!page.data?.length) return
  queryClient().setQueryData<EntriesQueryData>(query.queryKey, (data) => {
    const trimmed = trimTrailingEmptyPages(data)
    return (
      trimmed && { pages: [...trimmed.pages, page], pageParams: [...trimmed.pageParams, pageParam] }
    )
  })
}

// `since` is read from the server's clock and `dataUpdatedAt` from this device's, so a list only
// counts as fetched after the new entries when it is later by more than any likely clock skew
const CLOCK_SKEW_MARGIN_MS = 5 * 60 * 1000

/**
 * New entries arrived for these views. Fetch the edge of the entry lists that are on screen
 * where they arrive, the first page of a newest-first list, and merge it into what is loaded,
 * instead of refetching every loaded page.
 *
 * Lists that are not mounted are left alone: they are fetched again when they are opened.
 */
export const refreshEntriesHead = async ({
  views,
  since,
}: {
  views: FeedViewType[]
  /** Lists fetched after this moment already contain the new entries. */
  since?: number
}) => {
  const client = queryClient()
  const queries = client.getQueryCache().findAll({
    predicate: (query) => {
      const { queryKey } = query
      return (
        Array.isArray(queryKey) &&
        queryKey[0] === "entries" &&
        views.includes(queryKey[3] as FeedViewType)
      )
    },
  })

  await Promise.all(
    queries.map(async (query) => {
      const params = readEntriesQueryKey(query.queryKey)
      const isCollectionQuery =
        params.isCollection === true || params.feedId === FEED_COLLECTION_LIST
      // Collections do not change with new entries, and an AI sorted page is expensive to
      // recompute.
      if (isCollectionQuery || params.aiSort) return
      if (!query.isActive() || query.state.fetchStatus === "fetching") return
      if (!query.state.data) return
      if (since !== undefined && query.state.dataUpdatedAt > since + CLOCK_SKEW_MARGIN_MS) return

      if (params.sortOrder === "asc") {
        await refreshEntriesTail(query, params)
        return
      }

      const head = await fetchEntriesPage(params, undefined)
      client.setQueryData<EntriesQueryData>(query.queryKey, (current) =>
        mergeEntriesHead(current, head),
      )
    }),
  )
}

const defaultStaleTime = 10 * (60 * 1000) // 10 minutes
const toCursorTime = (value: Date | string | null | undefined) => {
  if (!value) return
  return typeof value === "string" ? value : value.toISOString()
}

export const useEntriesQuery = (
  props?: Omit<FetchEntriesProps, "pageParam" | "read"> & FetchEntriesPropsSettings,
  options?: {
    subscribed?: boolean
  },
) => {
  const { feedId, inboxId, view, limit, feedIdList, isCollection, unreadOnly, aiSort, sortOrder } =
    props || {}

  const fetchUnread = unreadOnly
  const feedUnreadDirty = useFeedUnreadIsDirty((feedId as string) || "")
  const effectiveSortOrder = getEffectiveEntrySortOrder({
    sortOrder: aiSort ? "desc" : sortOrder,
    unreadOnly: unreadOnly === true,
    isTimelineSource: isTimelineEntriesSource({ feedId, inboxId, isCollection }),
  })

  const isPop =
    "history" in globalThis && "isPop" in globalThis.history && !!globalThis.history.isPop
  const queryKey = useMemo(
    () => [
      "entries",
      feedId,
      inboxId,
      view,
      limit,
      feedIdList,
      isCollection,
      unreadOnly,
      aiSort,
      effectiveSortOrder,
    ],
    [
      feedId,
      inboxId,
      view,
      limit,
      feedIdList,
      isCollection,
      unreadOnly,
      aiSort,
      effectiveSortOrder,
    ],
  )

  const entriesQuery = useMemo(() => entriesQueryOptions(queryKey), [queryKey])
  const query = useInfiniteQuery({
    ...entriesQuery,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // TanStack would fetch every loaded page again on its own, after an invalidation or when
    // the list is opened again; the effect below fetches its first page instead.
    refetchOnMount: false,
    staleTime: "static",
    enabled: !!props,
    subscribed: options?.subscribed,
  })
  const { fetchNextPage: queryFetchNextPage } = query
  // The client the query lives in, to see what it is fetching when the next page is asked for
  const reactQueryClient = useQueryClient()
  const fetchNextPage = useCallback(
    (options?: Parameters<typeof queryFetchNextPage>[0]) =>
      fetchNextPageAfterRefetch(
        reactQueryClient.getQueryState(queryKey),
        queryFetchNextPage,
        options,
      ),
    [queryFetchNextPage, queryKey, reactQueryClient],
  )
  // A refresh starts over from the top: it fetches the first page alone, which replaces the
  // loaded pages once it is in, and a failed one leaves them on screen. Refetching every loaded
  // page would request each page the user scrolled through again, one after another.
  const refetch = useCallback(async (): Promise<Error | null> => {
    // As a TanStack refetch does, it takes over from a fetch under way, a next page included
    void reactQueryClient.cancelQueries({ queryKey, exact: true })
    try {
      await reactQueryClient.infiniteQuery({ ...entriesQuery, pages: 1, staleTime: 0 })
      return null
    } catch (error) {
      // A later refresh took over and tells how it went
      return isCancelledError(error) ? null : (error as Error)
    }
  }, [entriesQuery, queryKey, reactQueryClient])

  // Entering a list, by opening it, switching to it or showing it again, fetches its first page
  // when it is out of date. Going back keeps it as it was, with its deep pages and position.
  const isShown = !!props && options?.subscribed !== false
  useEffect(() => {
    if (!isShown || isPop) return
    const state = reactQueryClient.getQueryState(queryKey)
    if (!state?.data) return
    const isOutdated =
      state.isInvalidated ||
      Date.now() - state.dataUpdatedAt > defaultStaleTime ||
      (fetchUnread && feedUnreadDirty)
    if (isOutdated) void refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the list is entered
  }, [queryKey, isShown])

  // A failed request leaves the loaded entries as they are; `error` tells of it
  const entriesIds = useMemo(
    () =>
      query.data?.pages.flatMap((page) => page.data?.map((entry) => entry.entries.id) ?? []) ?? [],
    [query.data],
  )

  // Marking the list read up to its end covers the loaded entries and none that arrived since.
  // The server compares the bound with its own clock, which the entries carry. It sends
  // milliseconds and keeps more, so the newest is covered a millisecond later.
  const insertedBefore = useMemo(() => {
    let newest: number | undefined
    for (const page of query.data?.pages ?? []) {
      for (const { entries } of page.data ?? []) {
        newest = Math.max(newest ?? 0, Date.parse(entries.insertedAt))
      }
    }
    return newest === undefined ? undefined : newest + 1
  }, [query.data])

  const unreadScope = useMemo<UnreadListScope>(
    () => ({
      view,
      feedId: feedId === undefined ? undefined : String(feedId),
      feedIdList,
      inboxId: inboxId === undefined ? undefined : String(inboxId),
      isCollection,
    }),
    [view, feedId, feedIdList?.toString(), inboxId, isCollection],
  )
  // Once every unread entry is on screen, a counter above the list can only be wrong.
  const unreadListComplete =
    fetchUnread === true &&
    !aiSort &&
    query.isSuccess &&
    !query.isFetching &&
    query.hasNextPage === false
  useSyncUnreadWhenUnMatch(entriesIds, { scope: unreadScope, complete: unreadListComplete })

  return useMemo(() => {
    return {
      ...query,
      fetchNextPage,
      refetch,
      entriesIds,
      insertedBefore,
      queryKey,
    }
  }, [entriesIds, fetchNextPage, insertedBefore, query, queryKey, refetch])
}

export const usePrefetchEntryDetail = (
  entryId: string | undefined,
  isInbox?: boolean,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: ["entry", entryId],
    queryFn: () => entrySyncServices.fetchEntryDetail(entryId, isInbox),
    enabled: options?.enabled,
  })
}

const defaultSelector = (state: EntryModel) => state

export function useEntry<T>(
  id: string | undefined,
  selector: (state: EntryModel) => T,
): T | undefined {
  return useEntryStore((state) => {
    if (!id) return
    const entry = state.data[id]
    if (!entry) return
    return selector(entry)
  })
}
export const useHasEntry = (id: string) => {
  return useEntryStore(useCallback((state) => getHasEntrySelector(state)(id), [id]))
}
export function useEntryList(ids: string[]): Array<EntryModel | null>
export function useEntryList<T>(ids: string[], selector: (state: EntryModel) => T): T[] | undefined
export function useEntryList(
  ids: string[],
  selector: (state: EntryModel) => EntryModel = defaultSelector,
) {
  return useEntryStore((state) => {
    return ids.map((id) => {
      const entry = state.data[id]
      if (!entry) return null
      return selector(entry)
    })
  })
}

// The `enabled` flag lets a list hook stay in place, as hooks must, while selecting nothing: the
// stored entries are only shown until the server's list is in, and sorting them on every store
// change would cost the same either way.

export const useEntryIdsByView = (view: FeedViewType, enabled = true) => {
  return useEntryStore(
    useCallback(
      (state) => (enabled ? getEntryIdsByViewSelector(state)(view) : null),
      [enabled, view],
    ),
  )
}

export const useEntryIdsByFeedId = (feedId: string | undefined | null, enabled = true) => {
  return useEntryStore(
    useCallback(
      (state) => (enabled ? getEntryIdsByFeedIdSelector(state)(feedId) : null),
      [enabled, feedId],
    ),
  )
}

export const useEntryIdsByFeedIds = (feedIds: string[] | undefined, enabled = true) => {
  return useEntryStore(
    useCallback(
      (state) => (enabled ? getEntryIdsByFeedIdsSelector(state)(feedIds) : null),
      [enabled, feedIds?.toString()],
    ),
  )
}

export const useEntryIdsByInboxId = (inboxId: string | undefined, enabled = true) => {
  return useEntryStore(
    useCallback(
      (state) => (enabled ? getEntryIdsByInboxIdSelector(state)(inboxId) : null),
      [enabled, inboxId],
    ),
  )
}

export const useEntryIsInbox = (entryId: string) => {
  return useEntryStore(useCallback((state) => getEntryIsInboxSelector(state)(entryId), [entryId]))
}
