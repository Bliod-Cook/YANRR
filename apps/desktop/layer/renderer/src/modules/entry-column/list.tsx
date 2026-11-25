import { EmptyIcon } from "@follow/components/icons/empty.jsx"
import { Button } from "@follow/components/ui/button/index.js"
import { useScrollViewElement } from "@follow/components/ui/scroll-area/hooks.js"
import type { FeedViewType } from "@follow/constants"
import { useTypeScriptHappyCallback } from "@follow/hooks"
import { shouldRenderScrollMarkReadEndSpacer } from "@follow/shared/scroll-mark-read"
import { LRUCache } from "@follow/utils/lru-cache"
import type { Range, VirtualItem, Virtualizer } from "@tanstack/react-virtual"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import type { HTMLMotionProps } from "motion/react"
import type { FC, MutableRefObject, ReactNode } from "react"
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"

import { useGeneralSettingKey } from "~/atoms/settings/general"
import { m } from "~/components/common/Motion"
import { useFeedHeaderTitle } from "~/store/feed/hooks"

import { VirtualRowItem } from "./components/VirtualRowItem"
import { EntryItemSkeleton } from "./EntryItemSkeleton"
import { useScrollMarkReadEndPadding } from "./hooks/useScrollMarkReadEndPadding"
import { getInitialScrollOffset, shouldApplyScrollResetSignal } from "./scroll-reset"
import { listVisibleRange } from "./visible-range"

export const EntryEmptyList = ({
  ref,
  error,
  offline,
  isRetrying,
  onRetry,
  ...props
}: HTMLMotionProps<"div"> & {
  ref?: React.Ref<HTMLDivElement | null>
  error?: unknown
  /** Nothing is cached and the entries load once the browser is back online. */
  offline?: boolean
  isRetrying?: boolean
  onRetry?: () => void
}) => {
  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const { t } = useTranslation()
  return (
    <m.div
      className="absolute -mt-6 flex size-full grow flex-col items-center justify-center gap-2 text-zinc-400"
      {...props}
      ref={ref}
    >
      {error != null ? (
        <div className="flex -translate-y-6 flex-col items-center justify-center gap-3">
          <i className="i-mgc-warning-cute-re text-3xl text-red" />
          <span className="text-base">{t("entry_list.load_failed")}</span>
          {onRetry && (
            <Button variant="outline" isLoading={isRetrying} onClick={onRetry}>
              {t("retry", { ns: "common" })}
            </Button>
          )}
        </div>
      ) : offline ? (
        <div className="flex -translate-y-6 flex-col items-center justify-center gap-2">
          <i className="i-mgc-wifi-off-cute-re text-3xl" />
          <span className="text-base">{t("entry_list.offline")}</span>
        </div>
      ) : unreadOnly ? (
        <>
          <i className="-mt-11 i-mgc-celebrate-cute-re text-3xl" />
          <span className="text-base">{t("entry_list.zero_unread")}</span>
        </>
      ) : (
        <div className="flex -translate-y-6 flex-col items-center justify-center gap-2">
          <EmptyIcon className="size-[30px]" />
          <span className="text-base">{t("words.zero_items")}</span>
        </div>
      )}
    </m.div>
  )
}

/** Where the next page loads, after a page or a refresh failed */
export const EntryLoadFailedRow = ({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean
  onRetry: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-3 py-6 text-sm text-text-secondary">
      <i className="i-mgc-warning-cute-re text-base text-red" />
      <span>{t("entry_list.load_failed")}</span>
      <Button variant="outline" size="sm" isLoading={isRetrying} onClick={onRetry}>
        {t("retry", { ns: "common" })}
      </Button>
    </div>
  )
}

export type EntryListProps = {
  syncType: "remote" | "local"
  feedId: string
  entriesIds: string[]
  view: FeedViewType

  hasNextPage: boolean
  fetchNextPage: () => void

  groupCounts?: number[]
  gap?: number

  Footer?: FC | ReactNode

  onRangeChange?: (range: Range) => void

  listRef?: MutableRefObject<Virtualizer<HTMLElement, Element> | undefined>
  /** Set by the layout to bring the entry at an index into view */
  scrollToEntryRef?: MutableRefObject<((index: number) => void) | undefined>
  appliedResetScrollSignal?: number
  onResetScrollSignalConsumed?: (signal: number) => void
  resetScrollSignal?: number
  suspendMarkRead?: boolean
}

const capacity = 3
const offsetCache = new LRUCache<string, number>(capacity)
const measurementsCache = new LRUCache<string, VirtualItem[]>(capacity)
// Prevent scroll list move when press up/down key, the up/down key should be taken over by the shortcut key we defined.
const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault()
  }
}
export const EntryList: FC<EntryListProps> = memo(
  ({
    feedId,
    view,
    entriesIds,
    fetchNextPage,
    hasNextPage,
    groupCounts,
    Footer,
    listRef,
    scrollToEntryRef,
    onRangeChange,
    gap,
    syncType,
    appliedResetScrollSignal,
    onResetScrollSignalConsumed,
    resetScrollSignal,
  }) => {
    const scrollRef = useScrollViewElement()
    const hasEndSpacer = shouldRenderScrollMarkReadEndSpacer({
      entryCount: entriesIds.length,
      hasNextPage,
    })
    const endSpacerHeight = useScrollMarkReadEndPadding(scrollRef, hasEndSpacer)

    const stickyIndexes = useMemo(
      () =>
        groupCounts
          ? groupCounts.reduce(
              (acc, count, index) => {
                acc[index + 1] = acc[index]! + count
                return acc
              },
              [0],
            )
          : [],
      [groupCounts],
    )

    // What the list shows and in which order, as the remembered offset and sizes belong to it
    const unreadOnly = useGeneralSettingKey("unreadOnly")
    const sortOrder = useGeneralSettingKey("timelineSortOrder")
    const cacheKey = `${view}-${feedId}-${unreadOnly}-${sortOrder}`
    const isResetScrollPending = shouldApplyScrollResetSignal({
      resetSignal: resetScrollSignal,
      appliedResetSignal: appliedResetScrollSignal,
    })
    const rowVirtualizer = useVirtualizer({
      count: entriesIds.length + 1,
      estimateSize: () => 112,
      overscan: 5,
      gap,
      // By entry, so rows keep their size and place when entries come in above them
      getItemKey: useCallback((index: number) => entriesIds[index] ?? "footer", [entriesIds]),
      getScrollElement: () => scrollRef,
      initialOffset: getInitialScrollOffset({
        cachedOffset: offsetCache.get(cacheKey),
        resetSignal: resetScrollSignal,
        appliedResetSignal: appliedResetScrollSignal,
      }),
      initialMeasurementsCache: measurementsCache.get(cacheKey) ?? [],
      onChange: useTypeScriptHappyCallback(
        (virtualizer: Virtualizer<HTMLElement, Element>) => {
          if (!virtualizer.isScrolling) {
            measurementsCache.put(cacheKey, virtualizer.measurementsCache)
            offsetCache.put(cacheKey, virtualizer.scrollOffset ?? 0)
          }

          if (virtualizer.range) onRangeChange?.(listVisibleRange(virtualizer.range) as Range)
        },
        [cacheKey, onRangeChange],
      ),
      rangeExtractor: useTypeScriptHappyCallback(
        (range: Range) => {
          activeStickyIndexRef.current =
            [...stickyIndexes].reverse().find((index) => range.startIndex >= index) ?? 0

          const next = new Set([activeStickyIndexRef.current, ...defaultRangeExtractor(range)])

          return [...next].sort((a, b) => a - b)
        },
        [stickyIndexes],
      ),
    })

    useEffect(() => {
      if (!listRef) return
      listRef.current = rowVirtualizer
    }, [rowVirtualizer, listRef])

    useEffect(() => {
      if (!scrollToEntryRef) return
      scrollToEntryRef.current = (index) => rowVirtualizer.scrollToIndex(index)
      return () => {
        scrollToEntryRef.current = undefined
      }
    }, [rowVirtualizer, scrollToEntryRef])

    useLayoutEffect(() => {
      if (!scrollRef) return
      if (!isResetScrollPending) return
      if (resetScrollSignal === undefined) return

      rowVirtualizer.scrollToOffset(0)
      scrollRef.scrollTop = 0
      scrollRef.scrollLeft = 0
      offsetCache.put(cacheKey, 0)
      onResetScrollSignalConsumed?.(resetScrollSignal)
    }, [
      cacheKey,
      isResetScrollPending,
      onResetScrollSignalConsumed,
      resetScrollSignal,
      rowVirtualizer,
      scrollRef,
    ])

    const activeStickyIndexRef = useRef(0)
    const checkIsActiveSticky = (index: number) => activeStickyIndexRef.current === index
    const checkIsStickyItem = (index: number) => stickyIndexes.includes(index)

    const virtualItems = rowVirtualizer.getVirtualItems()
    useEffect(() => {
      const lastItem = virtualItems.at(-1)

      if (!lastItem) {
        return
      }

      const isPlaceholderRow = lastItem.index === entriesIds.length

      if (isPlaceholderRow && hasNextPage) {
        fetchNextPage()
      }
    }, [entriesIds.length, fetchNextPage, hasNextPage, virtualItems, syncType])

    const [isScrollTop, setIsScrollTop] = useState(true)

    useEffect(() => {
      const $scrollRef = scrollRef
      if (!$scrollRef) return
      const handleScroll = () => {
        setIsScrollTop($scrollRef.scrollTop <= 0)
      }
      $scrollRef.addEventListener("scroll", handleScroll)

      return () => {
        $scrollRef.removeEventListener("scroll", handleScroll)
      }
    }, [scrollRef])

    const [ready, setReady] = useState(false)

    useEffect(() => {
      startTransition(() => {
        setReady(true)
      })
    }, [])

    const currentFeedTitle = useFeedHeaderTitle()!

    return (
      <div
        onKeyDown={handleKeyDown}
        className={"relative w-full select-none"}
        style={{
          height: `${rowVirtualizer.getTotalSize() + endSpacerHeight}px`,
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          if (!ready) return null
          // Last placeholder row
          const isLoaderRow = virtualRow.index === entriesIds.length

          const transform = `translateY(${virtualRow.start}px)`
          if (isLoaderRow) {
            const Content = hasNextPage ? (
              <EntryItemSkeleton view={view} count={6} />
            ) : Footer ? (
              typeof Footer === "function" ? (
                <Footer />
              ) : (
                Footer
              )
            ) : null

            return (
              <div
                ref={rowVirtualizer.measureElement}
                className="absolute top-0 left-0 w-full will-change-transform"
                key={virtualRow.key}
                data-index={virtualRow.index}
                style={{
                  transform,
                }}
              >
                {Content}
              </div>
            )
          }
          const isStickyItem = checkIsStickyItem(virtualRow.index)
          const isActiveStickyItem = !isScrollTop && checkIsActiveSticky(virtualRow.index)
          return (
            <VirtualRowItem
              key={virtualRow.key}
              virtualRowKey={virtualRow.key}
              entriesIds={entriesIds}
              virtualRowIndex={virtualRow.index}
              view={view}
              transform={transform}
              isStickyItem={isStickyItem}
              isActiveStickyItem={isActiveStickyItem}
              measureElement={rowVirtualizer.measureElement}
              currentFeedTitle={currentFeedTitle}
            />
          )
        })}
      </div>
    )
  },
)
