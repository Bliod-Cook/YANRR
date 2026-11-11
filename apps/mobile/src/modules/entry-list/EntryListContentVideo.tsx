import { useTypeScriptHappyCallback } from "@follow/hooks/shared"
import { StyleSheet, View } from "react-native"

import { useBottomTabBarHeight } from "@/src/components/layouts/tabbar/hooks"
import { Skeleton, SkeletonPulse } from "@/src/components/ui/skeleton/Skeleton"
import { useIsTabletLayout } from "@/src/lib/responsive"
import { useHeaderHeight } from "@/src/modules/screen/hooks/useHeaderHeight"

import { TimelineSelectorList } from "../screen/TimelineSelectorList"
import { EntryListFooter } from "./EntryListFooter"
import { useEntryListViewability } from "./hooks"
import { EntryVideoItem } from "./templates/EntryVideoItem"
import type { EntryListContentProps } from "./types"

const VIDEO_SKELETON_KEYS = ["video-skeleton-1", "video-skeleton-2", "video-skeleton-3"] as const

export const EntryListContentVideo = ({
  ref,
  entries,
  active,
  onResetScrollSignalConsumed,
  resetScrollSignal,
  suspendMarkRead,
}: EntryListContentProps) => {
  const {
    entriesIds: entryIds,
    error,
    fetchNextPage,
    refetch,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    isReady,
  } = entries
  const isTablet = useIsTabletLayout()
  const viewability = useEntryListViewability({ entries, active, suspendMarkRead })

  const renderItem = useTypeScriptHappyCallback(({ item }: { item: string }) => {
    return <EntryVideoItem id={item} />
  }, [])

  const headerHeight = useHeaderHeight()
  const tabBarHeight = useBottomTabBarHeight()

  // Show loading skeleton when entries are not ready and no data yet
  if (!isReady && entryIds.length === 0) {
    // A page next to the shown one in the pager does not load, so its placeholders hold still
    const animateLoadingPlaceholder = active !== false
    return (
      <View
        className="flex-1 px-2"
        style={{ paddingTop: headerHeight, paddingBottom: tabBarHeight }}
      >
        <View className="flex-row">
          <View className="mr-1 flex-1">
            {VIDEO_SKELETON_KEYS.map((key) => (
              <EntryVideoItemSkeleton key={`left-${key}`} animated={animateLoadingPlaceholder} />
            ))}
          </View>
          <View className="ml-1 flex-1">
            {VIDEO_SKELETON_KEYS.map((key) => (
              <EntryVideoItemSkeleton key={`right-${key}`} animated={animateLoadingPlaceholder} />
            ))}
          </View>
        </View>
      </View>
    )
  }

  // Kept far below the screen as long as there is a next page, so it moves only while that
  // page loads
  const animateNextPagePlaceholder = active !== false && isFetchingNextPage
  return (
    <TimelineSelectorList
      ref={ref}
      masonry
      onRefresh={refetch}
      isRefetching={isRefetching}
      emptyError={error}
      onResetScrollSignalConsumed={onResetScrollSignalConsumed}
      resetScrollSignal={resetScrollSignal}
      data={entryIds}
      renderItem={renderItem}
      keyExtractor={defaultKeyExtractor}
      onEndReached={hasNextPage ? fetchNextPage : undefined}
      {...viewability}
      numColumns={isTablet ? 3 : 2}
      contentContainerStyle={isTablet ? styles.tabletContentContainer : styles.contentContainer}
      ListFooterComponent={
        hasNextPage ? (
          <View className="flex flex-row justify-between">
            <EntryVideoItemSkeleton animated={animateNextPagePlaceholder} />
            <EntryVideoItemSkeleton animated={animateNextPagePlaceholder} />
          </View>
        ) : (
          <EntryListFooter entries={entries} />
        )
      }
    />
  )
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: 8,
  },
  tabletContentContainer: {
    paddingHorizontal: 16,
  },
})

const defaultKeyExtractor = (item: string) => {
  return item
}

function EntryVideoItemSkeleton({ animated }: { animated: boolean }) {
  return (
    <SkeletonPulse animated={animated} className="m-1 overflow-hidden rounded-md">
      {/* Video thumbnail */}
      <Skeleton className="h-32 w-full rounded-md" style={{ aspectRatio: 16 / 9 }} />

      {/* Description and footer */}
      <View className="my-2 px-2">
        {/* Description */}
        <Skeleton className="mb-1 h-4 w-full rounded-md" />
        <Skeleton className="mb-3 h-4 w-3/4 rounded-md" />

        {/* Footer with feed icon and metadata */}
        <View className="flex-row items-center gap-1">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-3 w-24 rounded-md" />
          <Skeleton className="h-3 w-20 rounded-md" />
        </View>
      </View>
    </SkeletonPulse>
  )
}
