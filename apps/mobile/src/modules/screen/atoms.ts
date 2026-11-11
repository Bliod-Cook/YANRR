import { FeedViewType } from "@follow/constants"
import { useCollectionEntryList } from "@follow/store/collection/hooks"
import { FEED_COLLECTION_LIST } from "@follow/store/constants/app"
import {
  getEntriesListQueryKey,
  useEntriesQuery,
  useEntryIdsByFeedId,
  useEntryIdsByFeedIds,
  useEntryIdsByInboxId,
  useEntryIdsByView,
} from "@follow/store/entry/hooks"
import { useEntryStore } from "@follow/store/entry/store"
import type {
  FetchEntriesProps,
  UseEntriesProps,
  UseEntriesReturn,
} from "@follow/store/entry/types"
import { isTimelineEntriesSource } from "@follow/store/entry/utils"
import { useFeedById } from "@follow/store/feed/hooks"
import { useInboxById } from "@follow/store/inbox/hooks"
import { getSubscriptionByCategory } from "@follow/store/subscription/getter"
import { useSubscriptionByFeedId, useViewWithSubscription } from "@follow/store/subscription/hooks"
import { jotaiStore } from "@follow/utils"
import { EventBus } from "@follow/utils/event-bus"
import { useIsFetching } from "@tanstack/react-query"
import { debounce } from "es-toolkit"
import { atom, useAtomValue } from "jotai"
import type { ReactNode } from "react"
import {
  createContext,
  createElement,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import type { SharedValue } from "react-native-reanimated"
import { makeMutable, useSharedValue } from "react-native-reanimated"

import { useFetchEntriesSettings } from "@/src/atoms/settings/general"
import { views } from "@/src/constants/views"
import { toastFetchError } from "@/src/lib/error-parser"

import type { RemoteTimelineEntries, TimelineEntries } from "./timeline-entries"
import {
  getRemoteTimelineEntries,
  joinRefreshAttempt,
  pickTimelineEntries,
} from "./timeline-entries"

export type SelectedTimeline = {
  type: "view"
  viewId: FeedViewType
}

/**
 * What a feed screen lists: a feed (or the starred entries, `FEED_COLLECTION_LIST`), a category
 * by its name, or an inbox
 */
export type SelectedFeed = {
  type: "feed" | "category" | "inbox"
  id: string
}

const selectedTimelineAtom = atom<SelectedTimeline>({
  type: "view",
  viewId: FeedViewType.Articles,
})
const selectedViewAtom = atom((get) => get(selectedTimelineAtom).viewId)

export const EntryListContext = createContext<
  | { type: "timeline" | "subscriptions" }
  | {
      type: "feed"
      selectedFeed: SelectedFeed
      isPreview: boolean
      // The view of the subscription the screen shows, which wins over the view selected on Home
      view?: FeedViewType
    }
>({ type: "timeline" })
export const useEntryListContext = () => {
  return use(EntryListContext)
}

const useIsPreview = () => {
  const entryListContext = useEntryListContext()
  return entryListContext.type === "feed" && entryListContext.isPreview
}

export function useSelectedView() {
  const entryListContext = useEntryListContext()
  const selectedView = useAtomValue(selectedViewAtom)
  return (entryListContext.type === "feed" ? entryListContext.view : undefined) ?? selectedView
}

export const getSelectedView = () => {
  return jotaiStore.get(selectedTimelineAtom).viewId
}

/** What the list here shows: the view selected on Home, or what its feed screen was opened for */
export function useSelectedFeed(): SelectedTimeline | SelectedFeed {
  const entryListContext = useEntryListContext()
  const selectedTimeline = useAtomValue(selectedTimelineAtom)
  return entryListContext.type === "feed" ? entryListContext.selectedFeed : selectedTimeline
}

export const getFetchEntryPayload = (
  selectedFeed: SelectedTimeline | SelectedFeed,
  view: FeedViewType = FeedViewType.Articles,
): FetchEntriesProps => {
  switch (selectedFeed.type) {
    case "view": {
      return { view: selectedFeed.viewId }
    }
    case "category": {
      return { feedIdList: getSubscriptionByCategory({ category: selectedFeed.id, view }) }
    }
    case "inbox": {
      return { inboxId: selectedFeed.id }
    }
    case "feed": {
      return selectedFeed.id === FEED_COLLECTION_LIST
        ? { feedId: selectedFeed.id, view, isCollection: true }
        : { feedId: selectedFeed.id }
    }
  }
}

/** Timelines can be read oldest first; inboxes, the starred entries and previews cannot */
export function useIsTimelineEntrySource() {
  const isPreview = useIsPreview()
  const selectedFeed = useSelectedFeed()
  return !isPreview && isTimelineSelection(selectedFeed)
}

const isTimelineSelection = (selectedFeed: SelectedTimeline | SelectedFeed) =>
  isTimelineEntriesSource({
    feedId: selectedFeed.type === "feed" ? selectedFeed.id : undefined,
    inboxId: selectedFeed.type === "inbox" ? selectedFeed.id : undefined,
  })

/** The entries list shown here, as the store's entries query takes it */
function useEntriesQueryProps(viewId?: FeedViewType) {
  const isPreview = useIsPreview()
  const selectedFeed = useSelectedFeed()
  const selectedView = useSelectedView()
  const view = viewId ?? selectedView
  const payload = getFetchEntryPayload(
    selectedFeed.type === "view" ? { type: "view", viewId: view } : selectedFeed,
    view,
  )
  const options = useFetchEntriesSettings({
    isTimelineSource: !isPreview && isTimelineSelection(selectedFeed),
    unreadOnlyEnabled: !isPreview,
  })
  return { view, payload, options }
}

/**
 * Whether the entries list shown here is loading, without loading it a second time. The list is
 * named by where its entries come from; the reading settings only refine its query key.
 */
export function useIsFetchingEntries() {
  const { payload } = useEntriesQueryProps()
  return useIsFetching({ queryKey: getEntriesListQueryKey(payload) }) > 0
}

function useRemoteEntries({ viewId, active }: UseEntriesProps): RemoteTimelineEntries {
  const { payload, options } = useEntriesQueryProps(viewId)
  const query = useEntriesQuery({ ...payload, ...options }, { subscribed: active !== false })

  const refetch = useCallback(async () => void query.refetch(), [query])
  const refreshAttemptRef = useRef<Promise<void> | null>(null)
  const refetchReportingFailure = useCallback(
    () =>
      joinRefreshAttempt(refreshAttemptRef, async () => {
        const error = await query.refetch()
        if (error) toastFetchError(error)
      }),
    [query],
  )
  const fetchNextPage = useCallback(async () => void query.fetchNextPage(), [query])

  return getRemoteTimelineEntries(query, { refetch, refetchReportingFailure, fetchNextPage })
}

const NO_ENTRY_IDS: string[] = []

/** The stored entries, shown until the server's list is in; computes nothing unless `enabled` */
function useLocalEntries(viewId: FeedViewType | undefined, enabled: boolean): UseEntriesReturn {
  const { view, payload, options } = useEntriesQueryProps(viewId)
  const { feedId, feedIdList, inboxId, isCollection } = payload
  const { sortOrder, unreadOnly } = options

  const entryIdsByView = useEntryIdsByView(view, enabled)
  const entryIdsByCollections = useCollectionEntryList(view, enabled)
  const entryIdsByFeedId = useEntryIdsByFeedId(feedId, enabled)
  const entryIdsByCategory = useEntryIdsByFeedIds(feedIdList, enabled)
  const entryIdsByInboxId = useEntryIdsByInboxId(inboxId, enabled)

  const showEntriesByView =
    !feedId && (!feedIdList || feedIdList?.length === 0) && !isCollection && !inboxId

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

        const orderedIds = sortOrder === "asc" ? [...ids].reverse() : ids

        return orderedIds
          .map((id) => {
            const entry = state.data[id]
            if (!entry) return null
            if (unreadOnly && entry.read) {
              return null
            }
            return entry.id
          })
          .filter((id) => typeof id === "string")
      },
      [
        entryIdsByCategory,
        entryIdsByCollections,
        entryIdsByFeedId,
        entryIdsByInboxId,
        entryIdsByView,
        isCollection,
        showEntriesByView,
        enabled,
        sortOrder,
        unreadOnly,
      ],
    ),
  )

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

  // A category is a new list on every render, so its ids stand for it
  const feedIdsKey = feedIdList?.join(",")
  useEffect(() => {
    setPage(0)
  }, [view, feedId, feedIdsKey, inboxId, isCollection, sortOrder, unreadOnly])

  return {
    entriesIds: entries,
    hasNext,
    refetch,
    fetchNextPage,
    isLoading: false,
    isRefetching: false,
    isReady: true,
    isFetchingNextPage: false,
    isFetching: false,
    hasNextPage: hasNext,
    error: null,
  }
}

function getEntryIdsFromMultiplePlace(...entryIds: Array<string[] | undefined | null>) {
  return entryIds.find((ids) => ids?.length) ?? []
}

export function useEntries({ viewId, active = true }: UseEntriesProps = {}): TimelineEntries {
  const remoteQuery = useRemoteEntries({ viewId, active })
  const localQuery = useLocalEntries(viewId, !remoteQuery.isReady)

  return pickTimelineEntries(remoteQuery, localQuery)
}

export const useSelectedFeedTitle = () => {
  const selectedFeed = useSelectedFeed()

  const viewDef = useViewDefinition(selectedFeed.type === "view" ? selectedFeed.viewId : undefined)
  const feedId = selectedFeed.type === "feed" ? selectedFeed.id : ""
  const feed = useFeedById(feedId)
  const feedSubscription = useSubscriptionByFeedId(feedId)
  const inbox = useInboxById(selectedFeed.type === "inbox" ? selectedFeed.id : "")
  const { t } = useTranslation("common")

  switch (selectedFeed.type) {
    case "view": {
      return viewDef?.name ? t(viewDef.name) : ""
    }
    case "feed": {
      return selectedFeed.id === FEED_COLLECTION_LIST
        ? t("words.starred")
        : feedSubscription?.title || feed?.title || ""
    }
    case "category": {
      return selectedFeed.id
    }
    case "inbox": {
      return inbox?.title ?? t("words.inbox")
    }
  }
}

declare module "@follow/utils/event-bus" {
  export interface CustomEvent {
    SELECT_TIMELINE: {
      view: SelectedTimeline
      target: string | undefined
    }
  }
}

export const selectTimeline = (state: SelectedTimeline, target?: string) => {
  jotaiStore.set(selectedTimelineAtom, state)
  EventBus.dispatch("SELECT_TIMELINE", {
    view: state,
    target,
  })
}

export const useViewDefinition = (view?: FeedViewType) => {
  const viewDef = useMemo(() => views.find((v) => v.view === view), [view])
  return viewDef
}

const TimelineSelectorDragProgressContext = createContext<SharedValue<number> | null>(null)

export const TimelineSelectorDragProgressProvider = ({ children }: { children: ReactNode }) => {
  const selectedFeed = useSelectedFeed()
  const viewId = selectedFeed.type === "view" ? selectedFeed.viewId : undefined

  const activeViews = useViewWithSubscription()

  const activeViewIndex = useMemo(
    () => activeViews.indexOf(viewId as FeedViewType),
    [activeViews, viewId],
  )
  const initialPage = activeViewIndex
  const dragProgress = useSharedValue(initialPage)

  return createElement(
    TimelineSelectorDragProgressContext,
    {
      value: dragProgress,
    },
    children,
  )
}

export const useTimelineSelectorDragProgress = () => {
  const dragProgress = use(TimelineSelectorDragProgressContext)
  if (!dragProgress) {
    console.error(
      "useTimelineSelectorDragProgress must be used within TimelineSelectorDragProgressProvider",
    )
    return makeMutable(0)
  }
  return dragProgress
}
