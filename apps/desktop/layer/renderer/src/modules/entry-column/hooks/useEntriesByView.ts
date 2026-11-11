import { FeedViewType, getView } from "@follow/constants"
import { useCollectionEntryList } from "@follow/store/collection/hooks"
import { isOnboardingEntryUrl } from "@follow/store/constants/onboarding"
import {
  useEntriesQuery,
  useEntryIdsByFeedId,
  useEntryIdsByFeedIds,
  useEntryIdsByInboxId,
  useEntryIdsByView,
} from "@follow/store/entry/hooks"
import { entryActions, entrySyncServices, useEntryStore } from "@follow/store/entry/store"
import type { UseEntriesReturn } from "@follow/store/entry/types"
import { useFolderFeedsByFeedId } from "@follow/store/subscription/hooks"
import { unreadSyncService } from "@follow/store/unread/store"
import { nextFrame } from "@follow/utils"
import { useMutation } from "@tanstack/react-query"
import { debounce } from "es-toolkit/compat"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useGeneralSettingKey } from "~/atoms/settings/general"
import { ROUTE_FEED_PENDING } from "~/constants/app"
import { useFeature } from "~/hooks/biz/useFeature"
import { useRouteParams } from "~/hooks/biz/useRouteParams"

import { aiTimelineEnabledAtom } from "../atoms/ai-timeline"
import { getEffectiveRouteEntrySortOrder } from "./entry-sort-order"
import { getVisibleLocalEntryIds } from "./filter-local-entry-ids"
import type { RemoteEntriesReturn } from "./remote-entries-fallback"
import { getRemoteEntriesFallback } from "./remote-entries-fallback"
import { useIsPreviewFeed } from "./useIsPreviewFeed"

const useRemoteEntries = (): RemoteEntriesReturn => {
  const { feedId, view, inboxId, isCollection } = useRouteParams()
  const isPreview = useIsPreviewFeed()

  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const savedSortOrder = useGeneralSettingKey("timelineSortOrder")
  const aiTimelineEnabled = useAtomValue(aiTimelineEnabledAtom)
  const aiEnabled = useFeature("ai")

  const folderIds = useFolderFeedsByFeedId({
    feedId,
    view,
  })
  const effectiveUnreadOnly = unreadOnly === true && !isPreview
  const effectiveSortOrder = getEffectiveRouteEntrySortOrder({
    sortOrder: savedSortOrder,
    unreadOnly: effectiveUnreadOnly,
    feedId,
    inboxId,
    isCollection,
    isPreview,
  })

  const entriesOptions = useMemo(
    () => ({
      feedId: folderIds?.join(",") || feedId,
      inboxId,
      view,
      ...(effectiveUnreadOnly && { unreadOnly: true }),
      ...(view === FeedViewType.All && { limit: 40 }),
      ...(aiTimelineEnabled && aiEnabled && effectiveSortOrder === "desc" && { aiSort: true }),
      sortOrder: effectiveSortOrder,
    }),
    [
      feedId,
      folderIds,
      inboxId,
      effectiveUnreadOnly,
      view,
      aiTimelineEnabled,
      aiEnabled,
      effectiveSortOrder,
    ],
  )
  const query = useEntriesQuery(entriesOptions)

  const refetch = useCallback(async () => void query.refetch(), [query])
  const fetchNextPage = useCallback(async () => void query.fetchNextPage(), [query])

  if (!query.data) {
    return getRemoteEntriesFallback(query, refetch)
  }
  // Once in, the list stays when a later request fails, which `error` tells of
  return {
    entriesIds: query.entriesIds,
    hasNext: query.hasNextPage,
    refetch,

    fetchNextPage,
    isLoading: query.isFetching,
    isRefetching: query.isRefetching,
    isReady: true,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetching: query.isFetching,
    hasNextPage: query.hasNextPage,
    error: query.error,
    isFetchNextPageError: query.isFetchNextPageError,
    insertedBefore: query.insertedBefore,
    queryKey: query.queryKey,
  }
}

const NO_ENTRY_IDS: string[] = []

function getEntryIdsFromMultiplePlace(...entryIds: Array<string[] | undefined | null>) {
  return entryIds.find((ids) => ids?.length) ?? []
}

/** The stored entries, shown until the server's list is in; computes nothing unless `enabled` */
const useLocalEntries = (enabled: boolean): UseEntriesReturn => {
  const { feedId, view, inboxId, isCollection } = useRouteParams()
  const isPreview = useIsPreviewFeed()
  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const savedSortOrder = useGeneralSettingKey("timelineSortOrder")
  const effectiveUnreadOnly = unreadOnly && !isPreview
  const effectiveSortOrder = getEffectiveRouteEntrySortOrder({
    sortOrder: savedSortOrder,
    unreadOnly: effectiveUnreadOnly,
    feedId,
    inboxId,
    isCollection,
    isPreview,
  })

  const folderIds = useFolderFeedsByFeedId({
    feedId,
    view,
  })
  const entryIdsByView = useEntryIdsByView(view, enabled)
  const entryIdsByCollections = useCollectionEntryList(view, enabled)
  const entryIdsByFeedId = useEntryIdsByFeedId(feedId, enabled)
  const entryIdsByCategory = useEntryIdsByFeedIds(folderIds, enabled)
  const entryIdsByInboxId = useEntryIdsByInboxId(inboxId, enabled)

  const showEntriesByView =
    (!feedId || feedId === ROUTE_FEED_PENDING) &&
    folderIds.length === 0 &&
    !isCollection &&
    !inboxId

  const localQueryKey = useMemo(
    () =>
      [feedId || "", view, inboxId || "", isCollection ? "1" : "0", effectiveSortOrder].join(":"),
    [effectiveSortOrder, feedId, inboxId, isCollection, view],
  )
  const stickyVisibleStateRef = useRef<{
    queryKey: string
    ids: Set<string>
  }>({
    queryKey: localQueryKey,
    ids: new Set<string>(),
  })

  const allEntries = useEntryStore(
    useCallback(
      (state) => {
        if (!enabled) return NO_ENTRY_IDS
        const ids = isCollection
          ? entryIdsByCollections
          : showEntriesByView
            ? (entryIdsByView ?? [])
            : (getEntryIdsFromMultiplePlace(
                entryIdsByFeedId,
                entryIdsByCategory,
                entryIdsByInboxId,
              ) ?? [])

        const stickyVisibleIds =
          effectiveUnreadOnly && stickyVisibleStateRef.current.queryKey === localQueryKey
            ? stickyVisibleStateRef.current.ids
            : undefined

        return getVisibleLocalEntryIds({
          sourceIds: effectiveSortOrder === "asc" ? [...ids].reverse() : ids,
          entries: state.data,
          stickyVisibleIds,
          unreadOnly: effectiveUnreadOnly,
        })
      },
      [
        entryIdsByCategory,
        entryIdsByCollections,
        entryIdsByFeedId,
        entryIdsByInboxId,
        entryIdsByView,
        isCollection,
        localQueryKey,
        showEntriesByView,
        effectiveSortOrder,
        effectiveUnreadOnly,
        enabled,
      ],
    ),
  )

  useEffect(() => {
    stickyVisibleStateRef.current = {
      queryKey: localQueryKey,
      ids: effectiveUnreadOnly ? new Set(allEntries) : new Set<string>(),
    }
  }, [allEntries, effectiveUnreadOnly, localQueryKey])

  const [page, setPage] = useState(0)
  const pageSize = 30
  const entries = useMemo(() => {
    return allEntries?.slice(0, (page + 1) * pageSize) || []
  }, [allEntries, page, pageSize])

  const hasNext = useMemo(() => {
    return entries.length < (allEntries?.length || 0)
  }, [entries.length, allEntries])

  const refetch = useCallback(async () => {
    setPage(0)
  }, [])

  const fetchNextPage = useCallback(
    debounce(async () => {
      setPage(page + 1)
    }, 300),
    [page],
  )

  useEffect(() => {
    setPage(0)
  }, [view, feedId, effectiveSortOrder, effectiveUnreadOnly])

  return {
    entriesIds: entries,
    hasNext,
    refetch,
    fetchNextPage: fetchNextPage as () => Promise<void>,
    isLoading: false,
    isRefetching: false,
    isReady: true,
    isFetchingNextPage: false,
    isFetching: false,
    hasNextPage: hasNext,
    error: null,
  }
}

export const useEntriesByView = ({ onReset }: { onReset?: () => void }) => {
  const { view } = useRouteParams()

  const remoteQuery = useRemoteEntries()
  const localQuery = useLocalEntries(!remoteQuery.isReady)

  useFetchEntryContentByStream(remoteQuery.entriesIds)

  // If remote data is not available, we use the local data, get the local data length
  // FIXME: remote first, then local store data
  // NOTE: We still can't use the store's data handling directly.
  // Imagine that the local data may be persistent, and then if there are incremental updates to the data on the server side,
  // then we have no way to incrementally update the data.
  // We need to add an interface to incrementally update the data based on the version hash.

  const query = remoteQuery.isReady ? remoteQuery : localQuery
  const entryIds: string[] = query.entriesIds

  const isFetchingFirstPage = remoteQuery.isFetching && !remoteQuery.isFetchingNextPage

  useEffect(() => {
    if (isFetchingFirstPage) {
      nextFrame(() => {
        onReset?.()
      })
    }
  }, [isFetchingFirstPage, query.queryKey])

  const groupByDate = useGeneralSettingKey("groupByDate")
  const groupedCounts: number[] | undefined = useMemo(() => {
    const viewDefinition = getView(view)
    if (viewDefinition?.gridMode || view === FeedViewType.All) {
      return
    }
    if (!groupByDate) {
      return
    }
    const entriesId2Map = entryActions.getFlattenMapEntries()
    const counts = [] as number[]
    let lastDate = ""
    for (const id of entryIds) {
      const entry = entriesId2Map[id]
      if (!entry) {
        continue
      }
      if (isOnboardingEntryUrl(entry.url)) {
        continue
      }
      const date = new Date(entry.publishedAt).toDateString()
      if (date !== lastDate) {
        counts.push(1)
        lastDate = date
      } else {
        const last = counts.pop()
        if (last) counts.push(last + 1)
      }
    }

    return counts
  }, [groupByDate, entryIds, view])

  return {
    ...query,

    type: remoteQuery.isReady ? ("remote" as const) : ("local" as const),
    refetch: useCallback(() => {
      // Until the remote query has succeeded the local query is shown, but a
      // refresh still has to retry the remote request.
      const promise = remoteQuery.isReady
        ? remoteQuery.refetch()
        : Promise.all([remoteQuery.refetch(), localQuery.refetch()]).then(() => {})
      void unreadSyncService.refresh({ calibrate: true })
      return promise
    }, [localQuery, remoteQuery]),
    entriesIds: entryIds,
    groupedCounts,
    isFetching: remoteQuery.isFetching,
    isFetchingNextPage: remoteQuery.isFetchingNextPage,
    isLoading: remoteQuery.isLoading,
    isOffline: remoteQuery.isOffline === true,
    error: remoteQuery.error,
    isFetchNextPageError: remoteQuery.isFetchNextPageError === true,
    // Only the server's list can be marked read up to its end: the stored one has no bound
    insertedBefore: remoteQuery.isReady ? remoteQuery.insertedBefore : undefined,
  }
}

const useFetchEntryContentByStream = (remoteEntryIds?: string[]) => {
  const { mutate: updateEntryContent } = useMutation({
    mutationKey: ["stream-entry-content", remoteEntryIds],
    mutationFn: (remoteEntryIds: string[]) =>
      entrySyncServices.fetchEntryContentByStream(remoteEntryIds),
  })

  useEffect(() => {
    if (!remoteEntryIds) return
    updateEntryContent(remoteEntryIds)
  }, [remoteEntryIds, updateEntryContent])
}
