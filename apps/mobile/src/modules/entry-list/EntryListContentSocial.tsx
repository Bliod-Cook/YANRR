import type { ListRenderItemInfo } from "@shopify/flash-list"
import { useCallback, useMemo } from "react"
import { View } from "react-native"

import { Skeleton, SkeletonPulse } from "@/src/components/ui/skeleton/Skeleton"
import { useReadableContainerStyle } from "@/src/lib/responsive"

import { TimelineSelectorList } from "../screen/TimelineSelectorList"
import { EntryListFooter } from "./EntryListFooter"
import { useEntryListViewability } from "./hooks"
import { ItemSeparatorFullWidth } from "./ItemSeparator"
import { EntrySocialItem } from "./templates/EntrySocialItem"
import type { EntryExtraData, EntryListContentProps } from "./types"

// The same centred column as the Articles view on iPad, so posts don't run the full screen width
const READABLE_MAX_WIDTH = 860
const READABLE_GUTTER = 16

const ReadableItemSeparator = () => {
  const readableItemStyle = useReadableContainerStyle(READABLE_MAX_WIDTH, READABLE_GUTTER)
  return (
    <View style={readableItemStyle}>
      <ItemSeparatorFullWidth />
    </View>
  )
}

const PLACEHOLDER_IDS = Array.from({ length: 5 }).map((_, index) => `skeleton-${index}`)

export const EntryListContentSocial = ({
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
    isFetchingNextPage,
    refetch,
    isRefetching,
    hasNextPage,
    isReady,
  } = entries
  const extraData: EntryExtraData = useMemo(() => ({ entryIds }), [entryIds])
  const readableItemStyle = useReadableContainerStyle(READABLE_MAX_WIDTH, READABLE_GUTTER)
  const viewability = useEntryListViewability({ entries, active, suspendMarkRead })

  const renderItem = useCallback(
    ({ item: id, extraData }: ListRenderItemInfo<string>) => (
      <View style={readableItemStyle}>
        <EntrySocialItem entryId={id} extraData={extraData as EntryExtraData} />
      </View>
    ),
    [readableItemStyle],
  )
  // A page next to the shown one in the pager does not load, so its placeholders hold still
  const animateLoadingPlaceholder = active !== false
  const renderLoadingSkeleton = useCallback(
    () => (
      <View style={readableItemStyle}>
        <EntryItemSkeleton animated={animateLoadingPlaceholder} />
      </View>
    ),
    [animateLoadingPlaceholder, readableItemStyle],
  )

  // Show loading skeleton when entries are not ready and no data yet
  if (!isReady && entryIds.length === 0) {
    return (
      <TimelineSelectorList
        // FlashList only listens for viewable items if it mounts with onViewableItemsChanged, so
        // the entries list must mount on its own instead of taking over this one, or scrolling
        // it never marks entries read. A pending scroll reset waits for the entries list too.
        key="placeholder"
        onRefresh={() => {}}
        isRefetching={false}
        data={PLACEHOLDER_IDS}
        keyExtractor={defaultKeyExtractor}
        renderItem={renderLoadingSkeleton}
        ItemSeparatorComponent={ReadableItemSeparator}
      />
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
      ItemSeparatorComponent={ReadableItemSeparator}
      ListFooterComponent={
        hasNextPage ? (
          <View style={readableItemStyle}>
            {/* Kept far below the screen as long as there is a next page, so it moves only
                while that page loads */}
            <EntryItemSkeleton animated={active !== false && isFetchingNextPage} />
          </View>
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
    <SkeletonPulse animated={animated} className="flex flex-col gap-2 p-4">
      {/* Header row with avatar, author, and date */}
      <View className="flex flex-1 flex-row items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-4 w-24 rounded-md" />
        <Skeleton className="h-3 w-20 rounded-md" />
      </View>

      {/* Description area */}
      <View className="ml-10 space-y-2">
        <Skeleton className="h-4 w-full rounded-md rounded-bl-none" />
        <Skeleton className="h-4 w-3/4 rounded-md rounded-tl-none" />
      </View>

      {/* Media preview area */}
      <View className="ml-10 flex flex-row gap-2">
        <Skeleton className="size-20 rounded-md" />
        <Skeleton className="size-20 rounded-md" />
      </View>
    </SkeletonPulse>
  )
}
