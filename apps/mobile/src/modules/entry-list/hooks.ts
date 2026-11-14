import { useScrollMarkReadGracePeriod } from "@follow/hooks/shared"
import { debouncedFetchEntryContentByStream } from "@follow/store/entry/store"
import { usePrefetchEntryTranslation } from "@follow/store/translation/hooks"
import { unreadSyncService } from "@follow/store/unread/store"
import { useIsLoggedIn } from "@follow/store/user/hooks"
import type { ViewToken } from "@shopify/flash-list"
import { useCallback, useInsertionEffect, useMemo, useRef, useState } from "react"
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native"

import { useAiEnabled } from "@/src/atoms/server-configs"
import { useActionLanguage, useGeneralSettingKey } from "@/src/atoms/settings/general"

import type { TimelineEntries } from "../screen/timeline-entries"
import type { LayoutVersion } from "./layout-version"
import { nextLayoutVersion } from "./layout-version"
import { collectEntriesScrolledPast } from "./scrolled-past"
import { getTranslationPrefetchIds } from "./translation-prefetch"

/**
 * What a list of entries does with the entries on screen: it loads their content and
 * translation, and marks them read once shown or once scrolled past, as the settings ask.
 */
export function useEntryListViewability({
  entries,
  active,
  suspendMarkRead,
}: {
  entries: TimelineEntries
  active?: boolean
  suspendMarkRead?: boolean
}) {
  const { entriesIds, isFetching, isFetchingNextPage } = entries
  const isLoggedIn = useIsLoggedIn()
  const markAsReadWhenScrolling = useGeneralSettingKey("scrollMarkUnread")
  const markAsReadWhenRendering = useGeneralSettingKey("renderMarkUnread")
  // Loading the next page only appends entries, so the ones scrolled past meanwhile still count
  const isRefreshing = isFetching && !isFetchingNextPage
  const disabled = active === false || isRefreshing || !!suspendMarkRead
  // The list moves under the reader while it changes, as when entries arrive at its head, so
  // what it reports visible right after such a change does not count. A page appended at its
  // end moves nothing on screen.
  const [layout, setLayout] = useState<LayoutVersion>({ entryIds: entriesIds, version: 0 })
  const nextLayout = nextLayoutVersion(layout, entriesIds)
  if (nextLayout !== layout) setLayout(nextLayout)
  const paused = useScrollMarkReadGracePeriod(isRefreshing, undefined, nextLayout.version)

  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const seenRef = useRef<ReadonlySet<string>>(new Set())
  const scrollRef = useRef({ offset: 0, isScrollingDown: false })

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.y
    scrollRef.current = { offset, isScrollingDown: offset > scrollRef.current.offset }
  }, [])

  const onViewableItemsChanged = useNonReactiveCallback(
    ({ viewableItems }: { viewableItems: ViewToken<string>[] }) => {
      const ids = viewableItems.map((item) => item.key)
      setVisibleIds(ids)
      debouncedFetchEntryContentByStream(ids)

      if (disabled) {
        seenRef.current = new Set()
        return
      }
      if (paused || !isLoggedIn) return

      // Scrolling down past the top, which leaves out the rebound of a pull to refresh
      const { offset, isScrollingDown } = scrollRef.current
      const isReadingOn = isScrollingDown && offset > 0
      if (markAsReadWhenRendering && isReadingOn) {
        void unreadSyncService.markEntriesAsRead(ids)
      }

      const { scrolledPast, seen } = collectEntriesScrolledPast({
        seen: seenRef.current,
        visible: ids,
        entryIds: entriesIds,
        // No entry on screen while reading on: only the end of the list is left
        pastEnd: isReadingOn,
      })
      seenRef.current = seen
      if (markAsReadWhenScrolling && scrolledPast.length > 0) {
        void unreadSyncService.markEntriesAsRead(scrolledPast)
      }
    },
  )

  const translation = useGeneralSettingKey("translation")
  const translationMode = useGeneralSettingKey("translationMode")
  const actionLanguage = useActionLanguage()
  const aiEnabled = useAiEnabled()
  usePrefetchEntryTranslation({
    entryIds: getTranslationPrefetchIds({ visibleIds, active, aiEnabled }),
    language: actionLanguage,
    enabled: translation,
    mode: translationMode,
  })

  return useMemo(() => ({ onViewableItemsChanged, onScroll }), [onScroll, onViewableItemsChanged])
}

function useNonReactiveCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  useInsertionEffect(() => {
    ref.current = fn
  }, [fn])
  return useCallback(
    (...args: any) => {
      const latestFn = ref.current
      return latestFn(...args)
    },
    [ref],
  ) as unknown as T
}
