import { useTypeScriptHappyCallback } from "@follow/hooks/shared"
import { StyleSheet, View } from "react-native"

import { useBottomTabBarHeight } from "@/src/components/layouts/tabbar/hooks"
import { PlatformActivityIndicator } from "@/src/components/ui/loading/PlatformActivityIndicator"
import { Skeleton, SkeletonPulse } from "@/src/components/ui/skeleton/Skeleton"
import { useIsTabletLayout } from "@/src/lib/responsive"
import { useHeaderHeight } from "@/src/modules/screen/hooks/useHeaderHeight"

import { TimelineSelectorList } from "../screen/TimelineSelectorList"
import { EntryListFooter } from "./EntryListFooter"
import { useEntryListViewability } from "./hooks"
import { EntryPictureItem } from "./templates/EntryPictureItem"
import type { EntryListContentProps } from "./types"

const PICTURE_SKELETON_COLUMN_KEYS = [
  "picture-skeleton-1",
  "picture-skeleton-2",
  "picture-skeleton-3",
  "picture-skeleton-4",
] as const

export const EntryListContentPicture = ({
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
    hasNextPage,
    isFetchingNextPage,
    isReady,
  } = entries
  const isTablet = useIsTabletLayout()
  const viewability = useEntryListViewability({ entries, active, suspendMarkRead })

  const renderItem = useTypeScriptHappyCallback(({ item }: { item: string }) => {
    return <EntryPictureItem id={item} />
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
            {PICTURE_SKELETON_COLUMN_KEYS.map((key, index) => (
              <EntryPictureItemSkeleton
                key={`left-${key}`}
                variantIndex={index}
                animated={animateLoadingPlaceholder}
              />
            ))}
          </View>
          <View className="ml-1 flex-1">
            {PICTURE_SKELETON_COLUMN_KEYS.map((key, index) => (
              <EntryPictureItemSkeleton
                key={`right-${key}`}
                variantIndex={index + PICTURE_SKELETON_COLUMN_KEYS.length}
                animated={animateLoadingPlaceholder}
              />
            ))}
          </View>
        </View>
      </View>
    )
  }

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
          <View className="h-20 items-center justify-center">
            {/* The list keeps the footer far below the screen, so it spins only while loading */}
            {active !== false && isFetchingNextPage && <PlatformActivityIndicator />}
          </View>
        ) : (
          <EntryListFooter entries={entries} />
        )
      }
    />
  )
}

function EntryPictureItemSkeleton({
  animated,
  variantIndex,
}: {
  animated: boolean
  variantIndex: number
}) {
  const imageHeightStyle =
    PICTURE_SKELETON_HEIGHT_STYLES[variantIndex % PICTURE_SKELETON_HEIGHT_STYLES.length]

  return (
    <SkeletonPulse animated={animated} className="mx-1 mb-2">
      {/* Image placeholder */}
      <Skeleton className="rounded-md" style={imageHeightStyle} />

      {/* Footer content */}
      <View className="gap-2 px-1 py-2">
        {/* Title lines */}
        <View className="gap-1">
          <Skeleton className="h-3 rounded-md" style={styles.titleLinePrimary} />
          <Skeleton className="h-3 rounded-md" style={styles.titleLineSecondary} />
        </View>

        {/* Feed info */}
        <View className="flex-row items-center gap-1.5">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 rounded-md" style={styles.feedLinePrimary} />
          <Skeleton className="h-3 rounded-md" style={styles.feedLineSecondary} />
        </View>
      </View>
    </SkeletonPulse>
  )
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: 8,
  },
  tabletContentContainer: {
    paddingHorizontal: 16,
  },
  skeletonHeight120: {
    height: 120,
  },
  skeletonHeight160: {
    height: 160,
  },
  skeletonHeight140: {
    height: 140,
  },
  skeletonHeight180: {
    height: 180,
  },
  skeletonHeight100: {
    height: 100,
  },
  skeletonHeight200: {
    height: 200,
  },
  titleLinePrimary: {
    width: "90%",
  },
  titleLineSecondary: {
    width: "70%",
  },
  feedLinePrimary: {
    width: "40%",
  },
  feedLineSecondary: {
    width: "30%",
  },
})

const PICTURE_SKELETON_HEIGHT_STYLES = [
  styles.skeletonHeight120,
  styles.skeletonHeight160,
  styles.skeletonHeight140,
  styles.skeletonHeight180,
  styles.skeletonHeight100,
  styles.skeletonHeight200,
] as const

const defaultKeyExtractor = (item: string) => {
  return item
}
