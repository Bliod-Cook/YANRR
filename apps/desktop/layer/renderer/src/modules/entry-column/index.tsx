import { FeedViewType, getView } from "@follow/constants"
import { useScrollMarkReadGracePeriod, useTitle } from "@follow/hooks"
import { getScrollMarkReadRangeState } from "@follow/shared/scroll-mark-read"
import { useEntry } from "@follow/store/entry/hooks"
import { useFeedById } from "@follow/store/feed/hooks"
import { useSubscriptionByFeedId } from "@follow/store/subscription/hooks"
import { unreadSyncService } from "@follow/store/unread/store"
import { useIsLoggedIn } from "@follow/store/user/hooks"
import { isBizId } from "@follow/utils/utils"
import { FollowAPIError } from "@follow-app/client-sdk"
import type { Range, Virtualizer } from "@tanstack/react-virtual"
import { atom, useAtomValue } from "jotai"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useGeneralSettingKey } from "~/atoms/settings/general"
import { Focusable } from "~/components/common/Focusable"
import { FeedNotFound } from "~/components/errors/FeedNotFound"
import { FEED_COLLECTION_LIST, HotkeyScope, ROUTE_FEED_PENDING } from "~/constants"
import { useNavigateEntry } from "~/hooks/biz/useNavigateEntry"
import { useRouteParams, useRouteParamsSelector } from "~/hooks/biz/useRouteParams"
import { useFeedQuery } from "~/queries/feed"
import { useFeedHeaderTitle } from "~/store/feed/hooks"

import { ActiveEntryShortcuts } from "./ActiveEntryShortcuts"
import { aiTimelineEnabledAtom } from "./atoms/ai-timeline"
import { AITimelineLoadingOverlay } from "./components/ai-timeline-loading/AITimelineLoadingOverlay"
import { EntryColumnWrapper } from "./components/entry-column-wrapper/EntryColumnWrapper"
import { FooterMarkItem } from "./components/FooterMarkItem"
import { EntriesProvider, useEntriesActions, useEntriesState } from "./context/EntriesContext"
import { EntryColumnShortcutHandler } from "./EntryColumnShortcutHandler"
import { EntryItemSkeleton } from "./EntryItemSkeleton"
import { EntryColumnGrid } from "./grid"
import { useAttachScrollBeyond } from "./hooks/useAttachScrollBeyond"
import { useEntryMarkReadHandler } from "./hooks/useEntryMarkReadHandler"
import { EntryListHeader } from "./layouts/EntryListHeader"
import { EntryEmptyList, EntryList, EntryLoadFailedRow } from "./list"
import {
  shouldResetScrollOnTimelineIdentityChange,
  shouldSuspendMarkReadForScrollReset,
} from "./scroll-reset"
import { EntryRootStateContext } from "./store/EntryColumnContext"

function EntryColumnContent() {
  const listRef = useRef<Virtualizer<HTMLElement, Element>>(undefined)
  const scrollToEntryRef = useRef<(index: number) => void>(undefined)
  const scrollToEntry = useCallback((index: number) => scrollToEntryRef.current?.(index), [])
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const state = useEntriesState()

  const isInteracted = useRef(false)
  const scrollMarkReadAnchorIndexRef = useRef<number | null>(null)
  const latestRangeStartIndexRef = useRef<number | null>(null)
  const latestRangeEndIndexRef = useRef<number | null>(null)
  const resetScrollInteractionState = useCallback(() => {
    isInteracted.current = false
    scrollMarkReadAnchorIndexRef.current = null
    latestRangeStartIndexRef.current = null
    latestRangeEndIndexRef.current = null
  }, [])

  const actions = useEntriesActions()
  const [resetScrollSignal, setResetScrollSignal] = useState<number>()
  const [appliedResetScrollSignal, setAppliedResetScrollSignal] = useState<number>()
  const isScrollResetPending = shouldSuspendMarkReadForScrollReset({
    resetSignal: resetScrollSignal,
    appliedResetSignal: appliedResetScrollSignal,
  })
  const handleResetScrollSignalConsumed = useCallback((signal: number) => {
    setAppliedResetScrollSignal((currentSignal) =>
      currentSignal === signal ? currentSignal : signal,
    )
  }, [])
  const scrollTimelineToTop = useCallback(() => {
    resetScrollInteractionState()
    setResetScrollSignal((signal) => (signal ?? 0) + 1)

    const runScrollToTop = () => {
      listRef.current?.scrollToOffset(0)

      const scrollArea = scrollAreaRef.current
      if (!scrollArea) return

      scrollArea.scrollTop = 0
      scrollArea.scrollLeft = 0
    }

    runScrollToTop()
    globalThis.requestAnimationFrame?.(runScrollToTop)
  }, [resetScrollInteractionState])
  const { entriesIds, groupedCounts } = state

  const {
    entryId: activeEntryId,
    view,
    feedId: routeFeedId,
    isPendingEntry,
    isCollection,
  } = useRouteParams()

  const entry = useEntry(activeEntryId, (state) => {
    const { feedId } = state
    return { feedId }
  })
  const feed = useFeedById(routeFeedId)
  const title = useFeedHeaderTitle()
  useTitle(title)
  const isLoggedIn = useIsLoggedIn()
  const timelineIdentity = `${view}:${routeFeedId ?? ""}`

  useEffect(() => {
    if (!activeEntryId) return

    if (isCollection || isPendingEntry) return
    if (!entry?.feedId) return

    if (!isLoggedIn) return
    unreadSyncService.markEntryAsRead(activeEntryId)
  }, [activeEntryId, entry?.feedId, isCollection, isPendingEntry, isLoggedIn])

  const isRefreshing = state.isFetching && !state.isFetchingNextPage
  const pauseScrollMarkRead = useScrollMarkReadGracePeriod(
    isRefreshing,
    undefined,
    timelineIdentity,
  )

  const previousTimelineIdentityRef = useRef<string>(undefined)
  useLayoutEffect(() => {
    const previousTimelineIdentity = previousTimelineIdentityRef.current
    previousTimelineIdentityRef.current = timelineIdentity

    resetScrollInteractionState()
    if (
      shouldResetScrollOnTimelineIdentityChange({
        enabled: view === FeedViewType.SocialMedia,
        previousTimelineIdentity,
        timelineIdentity,
      })
    ) {
      scrollTimelineToTop()
    }
  }, [resetScrollInteractionState, scrollTimelineToTop, timelineIdentity, view])

  const wasRefreshingRef = useRef(isRefreshing)
  useEffect(() => {
    const wasRefreshing = wasRefreshingRef.current
    wasRefreshingRef.current = isRefreshing
    // Only when a refresh starts
    if (!wasRefreshing && isRefreshing) scrollTimelineToTop()
  }, [isRefreshing, scrollTimelineToTop])

  const { handleRenderMarkRead, handleScrollMarkRead } = useEntryMarkReadHandler(entriesIds, {
    pauseScrollMarkRead,
  })

  const flushScrollMarkRead = useCallback(
    (currentStartIndex: number) => {
      if (!routeFeedId) return

      const { nextAnchorIndex, range } = getScrollMarkReadRangeState({
        anchorIndex: scrollMarkReadAnchorIndexRef.current,
        currentStartIndex,
      })
      scrollMarkReadAnchorIndexRef.current = nextAnchorIndex

      if (range) {
        handleScrollMarkRead?.(range as Range, isInteracted.current)
      }
    },
    [handleScrollMarkRead, routeFeedId],
  )

  const handleScroll = useCallback(() => {
    if (isScrollResetPending) {
      return
    }

    if (!isInteracted.current) {
      isInteracted.current = true
    }

    if (latestRangeStartIndexRef.current !== null) {
      flushScrollMarkRead(latestRangeStartIndexRef.current)
    }
  }, [flushScrollMarkRead, isScrollResetPending])

  const { handleScroll: handleScrollBeyond } = useAttachScrollBeyond()
  const handleCombinedScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      handleScrollBeyond(e)
      handleScroll()
    },
    [handleScrollBeyond, handleScroll],
  )

  const navigate = useNavigateEntry()

  const aiTimelineEnabled = useAtomValue(aiTimelineEnabledAtom)
  const showAiTimelineLoading = aiTimelineEnabled && state.isLoading && !state.isFetchingNextPage
  const renderAsRead = useGeneralSettingKey("renderMarkUnread")
  const handleRangeChange = useCallback(
    (e: Range) => {
      const startChanged = latestRangeStartIndexRef.current !== e.startIndex
      // Rows can come into view at the end while the first one stays
      if (!startChanged && latestRangeEndIndexRef.current === e.endIndex) {
        return
      }

      latestRangeStartIndexRef.current = e.startIndex
      latestRangeEndIndexRef.current = e.endIndex
      if (isScrollResetPending) {
        return
      }

      // Scrolling marks entries read by where the list starts
      if (startChanged) {
        if (scrollMarkReadAnchorIndexRef.current === null) {
          scrollMarkReadAnchorIndexRef.current = e.startIndex
        } else if (isInteracted.current) {
          flushScrollMarkRead(e.startIndex)
        }
      }

      if (!renderAsRead) return
      if (!getView(view)?.wideMode) {
        return
      }
      // For gird, render as mark read logic
      handleRenderMarkRead?.(e, isInteracted.current)
    },
    [flushScrollMarkRead, handleRenderMarkRead, isScrollResetPending, renderAsRead, view],
  )

  // With the server's entries on screen, a failed page or refresh is offered again where the next
  // page loads, instead of being asked for over and over
  const loadFailed = state.type === "remote" && state.error != null
  const hasNextPage = state.hasNextPage && !loadFailed
  // Waits while the list loads. This changes when the fetch ends, so the list asks again for a
  // page it asked for meanwhile.
  const fetchNextPage = useCallback(() => {
    if (hasNextPage && !state.isFetching) actions.fetchNextPage()
  }, [actions, hasNextPage, state.isFetching])

  // A new element on every render would defeat the list's memo
  const footer = useMemo(
    () =>
      loadFailed ? (
        <EntryLoadFailedRow
          isRetrying={state.isFetching}
          onRetry={state.isFetchNextPageError ? actions.fetchNextPage : actions.refetch}
        />
      ) : isCollection || state.insertedBefore === undefined ? undefined : (
        <FooterMarkItem view={view} insertedBefore={state.insertedBefore} />
      ),
    [
      actions,
      isCollection,
      loadFailed,
      state.insertedBefore,
      state.isFetchNextPageError,
      state.isFetching,
      view,
    ],
  )

  const ListComponent = getView(view)?.gridMode ? EntryColumnGrid : EntryList

  return (
    <Focusable
      scope={HotkeyScope.Timeline}
      data-hide-in-print
      className="relative flex h-full flex-1 flex-col @container"
      onClick={() =>
        navigate({
          view,
          entryId: null,
        })
      }
    >
      {entriesIds.length === 0 &&
        !state.isLoading &&
        !state.isOffline &&
        !state.error &&
        (!feed || feed?.type === "feed") && <AddFeedHelper />}

      <EntryListHeader
        refetch={actions.refetch}
        isRefreshing={isRefreshing}
        onBeforeRefresh={scrollTimelineToTop}
      />

      <EntryColumnWrapper
        ref={scrollAreaRef}
        onScroll={handleCombinedScroll}
        key={`${routeFeedId}-${view}`}
      >
        {entriesIds.length === 0 ? (
          // Guests can't load the timeline and the login modal covers it, so keep the placeholder
          state.isLoading || (!isLoggedIn && state.error) ? (
            <EntryItemSkeleton view={view} />
          ) : (
            <EntryEmptyList
              error={state.error}
              offline={state.isOffline}
              isRetrying={state.isFetching}
              onRetry={actions.refetch}
            />
          )
        ) : (
          <ListComponent
            gap={view === FeedViewType.SocialMedia ? 10 : undefined}
            listRef={listRef}
            scrollToEntryRef={scrollToEntryRef}
            onRangeChange={handleRangeChange}
            hasNextPage={hasNextPage}
            view={view}
            feedId={routeFeedId || ""}
            entriesIds={entriesIds}
            fetchNextPage={fetchNextPage}
            groupCounts={groupedCounts}
            appliedResetScrollSignal={appliedResetScrollSignal}
            onResetScrollSignalConsumed={handleResetScrollSignalConsumed}
            resetScrollSignal={resetScrollSignal}
            suspendMarkRead={isScrollResetPending}
            syncType={state.type}
            Footer={footer}
          />
        )}
        <ActiveEntryShortcuts />
        {/* Here for every layout and an empty list, and in the scroll area it focuses */}
        <EntryColumnShortcutHandler
          refetch={actions.refetch}
          data={entriesIds}
          handleScrollTo={scrollToEntry}
        />
      </EntryColumnWrapper>

      <AITimelineLoadingOverlay
        visible={showAiTimelineLoading}
        label={t("entry_list_header.ai_timeline_loading")}
      />
    </Focusable>
  )
}

function EntryColumnImpl() {
  return (
    <EntriesProvider>
      <EntryRootStateContext
        value={useMemo(
          () => ({
            isScrolledBeyondThreshold: atom(false),
          }),
          [],
        )}
      >
        <EntryColumnContent />
      </EntryRootStateContext>
    </EntriesProvider>
  )
}

const AddFeedHelper = () => {
  const feedId = useRouteParamsSelector((s) => s.feedId)
  const feedQuery = useFeedQuery({ id: feedId })

  const hasSubscription = useSubscriptionByFeedId(feedId || "")

  if (hasSubscription) {
    return null
  }

  if (!feedId) {
    return
  }
  if (feedId === FEED_COLLECTION_LIST || feedId === ROUTE_FEED_PENDING) {
    return null
  }
  if (!isBizId(feedId)) {
    return null
  }

  if (feedQuery.error instanceof FollowAPIError && feedQuery.error.status === 404) {
    throw new FeedNotFound()
  }
}

export const EntryColumn = memo(EntryColumnImpl)
