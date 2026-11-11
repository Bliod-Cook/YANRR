import type { ListRenderItemInfo } from "@shopify/flash-list"
import { useCallback, useMemo } from "react"
import { View } from "react-native"

import { useBottomTabBarHeight } from "@/src/components/layouts/tabbar/hooks"
import { Skeleton, SkeletonPulse } from "@/src/components/ui/skeleton/Skeleton"
import { useReadableContainerStyle } from "@/src/lib/responsive"
import { useHeaderHeight } from "@/src/modules/screen/hooks/useHeaderHeight"

import { TimelineSelectorList } from "../screen/TimelineSelectorList"
import { EntryListFooter } from "./EntryListFooter"
import { useEntryListViewability } from "./hooks"
import { EntryNormalItem } from "./templates/EntryNormalItem"
import type { EntryExtraData, EntryListContentProps } from "./types"

const ARTICLE_SKELETON_KEYS = [
  "article-skeleton-1",
  "article-skeleton-2",
  "article-skeleton-3",
  "article-skeleton-4",
  "article-skeleton-5",
  "article-skeleton-6",
  "article-skeleton-7",
] as const

export const EntryListContentArticle = ({
  ref,
  entries,
  active,
  view,
  onResetScrollSignalConsumed,
  resetScrollSignal,
  suspendMarkRead,
}: EntryListContentProps) => {
  const {
    entriesIds: entryIds,
    error,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
    hasNextPage,
    isReady,
  } = entries
  const extraData: EntryExtraData = useMemo(() => ({ entryIds }), [entryIds])
  const readableItemStyle = useReadableContainerStyle(860, 16)
  const viewability = useEntryListViewability({ entries, active, suspendMarkRead })

  const renderItem = useCallback(
    ({ item: id, extraData, index }: ListRenderItemInfo<string>) => (
      <View style={readableItemStyle}>
        <EntryNormalItem
          entryId={id}
          extraData={extraData as EntryExtraData}
          view={view}
          hasTopSeparator={index > 0}
          testID={index === 0 ? "timeline-entry-first" : undefined}
        />
      </View>
    ),
    [readableItemStyle, view],
  )

  const headerHeight = useHeaderHeight()
  const tabBarHeight = useBottomTabBarHeight()

  // Show loading skeleton when entries are not ready and no data yet
  if (!isReady && entryIds.length === 0) {
    return (
      <View className="flex-1" style={{ paddingTop: headerHeight, paddingBottom: tabBarHeight }}>
        {ARTICLE_SKELETON_KEYS.map((key) => (
          <View key={key} style={readableItemStyle}>
            {/* A page next to the shown one in the pager does not load, so it holds still */}
            <EntryItemSkeleton animated={active !== false} />
          </View>
        ))}
      </View>
    )
  }

  return (
    <TimelineSelectorList
      ref={ref}
      onRefresh={refetch}
      isRefetching={isRefetching}
      emptyError={error}
      onResetScrollSignalConsumed={onResetScrollSignalConsumed}
      resetScrollSignal={resetScrollSignal}
      data={entryIds}
      extraData={extraData}
      keyExtractor={defaultKeyExtractor}
      renderItem={renderItem}
      onEndReached={hasNextPage ? fetchNextPage : undefined}
      {...viewability}
      ListFooterComponent={
        hasNextPage ? (
          // Kept far below the screen as long as there is a next page, so it moves only while
          // that page loads
          <EntryItemSkeleton animated={active !== false && isFetchingNextPage} />
        ) : (
          <EntryListFooter entries={entries} separator />
        )
      }
    />
  )
}

const defaultKeyExtractor = (id: string) => id

export function EntryItemSkeleton({ animated }: { animated?: boolean }) {
  return (
    <SkeletonPulse
      animated={animated}
      className="flex flex-row items-center bg-system-background p-4"
    >
      <View className="flex flex-1 flex-col gap-2">
        <View className="flex flex-row gap-2">
          {/* Icon skeleton */}
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-1/4 rounded-md" />
        </View>

        {/* Title skeleton */}
        <Skeleton className="h-4 w-3/4 rounded-md" />
        {/* Description skeleton */}
        <Skeleton className="w-full flex-1 rounded-md" />
      </View>

      {/* Image skeleton */}
      <Skeleton className="ml-2 size-20 rounded-md" />
    </SkeletonPulse>
  )
}
