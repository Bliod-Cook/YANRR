import { FeedViewType } from "@follow/constants"
import { FEED_COLLECTION_LIST } from "@follow/store/constants/app"
import { useInboxList } from "@follow/store/inbox/hooks"
import {
  useGroupedSubscription,
  useSortedGroupedSubscription,
  useSortedUngroupedSubscription,
} from "@follow/store/subscription/hooks"
import { subscriptionSyncService } from "@follow/store/subscription/store"
import type { FlashListRef } from "@shopify/flash-list"
import type { ParseKeys } from "i18next"
import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { View } from "react-native"
import { useEventCallback } from "usehooks-ts"

import { useGeneralSettingKey, useHideAllReadSubscriptions } from "@/src/atoms/settings/general"
import { useRegisterNavigationScrollView } from "@/src/components/layouts/tabbar/hooks"
import {
  GROUPED_ICON_TEXT_GAP,
  GROUPED_LIST_ITEM_PADDING,
  GROUPED_LIST_MARGIN,
  GROUPED_SECTION_BOTTOM_MARGIN,
  GROUPED_SECTION_TOP_MARGIN,
} from "@/src/components/ui/grouped/constants"
import { GroupedInsetListCard } from "@/src/components/ui/grouped/GroupedList"
import { ItemPressableStyle } from "@/src/components/ui/pressable/enum"
import { ItemPressable } from "@/src/components/ui/pressable/ItemPressable"
import { Text } from "@/src/components/ui/typography/Text"
import { StarCuteFiIcon } from "@/src/icons/star_cute_fi"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { useReadableContainerStyle } from "@/src/lib/responsive"
import { TimelineSelectorList } from "@/src/modules/screen/TimelineSelectorList"
import { FeedScreen } from "@/src/screens/(stack)/feeds/[feedId]/FeedScreen"

import { CategoryGrouped } from "./CategoryGrouped"
import { SUBSCRIPTION_SORT } from "./constants"
import { InboxItem } from "./items/InboxItem"
import { SubscriptionItem } from "./items/SubscriptionItem"

const keyExtractor = (
  item:
    | string
    | {
        category: string
        subscriptionIds: string[]
      },
) => {
  if (typeof item === "string") {
    return item
  }
  return item.category
}
const SubscriptionListImpl = ({
  view,
  active = true,
}: {
  view: FeedViewType
  active?: boolean
}) => {
  const hideAllReadSubscriptions = useHideAllReadSubscriptions()
  const autoGroup = useGeneralSettingKey("autoGroup")
  const inboxes = useInboxList(
    useCallback(
      (inboxes) => (view === FeedViewType.Articles ? inboxes.map((inbox) => inbox.id) : []),
      [view],
    ),
  )
  const { grouped, unGrouped } = useGroupedSubscription({
    view,
    autoGroup,
  })
  const sortedGrouped = useSortedGroupedSubscription({
    view,
    grouped,
    ...SUBSCRIPTION_SORT,
    hideAllReadSubscriptions,
  })
  const sortedUnGrouped = useSortedUngroupedSubscription({
    ids: unGrouped,
    ...SUBSCRIPTION_SORT,
    hideAllReadSubscriptions,
  })
  const data = useMemo(
    () => [
      "words.starred",
      "words.inbox",
      ...inboxes,
      "words.feeds",
      ...sortedGrouped,
      ...sortedUnGrouped,
    ],
    [inboxes, sortedGrouped, sortedUnGrouped],
  )
  const extraData = useMemo(() => {
    const inboxIndexStart = 2
    const inboxIndexEnd = inboxIndexStart + inboxes.length - 1
    const feedsIndexStart = inboxIndexEnd + 2
    const feedsIndexEnd = feedsIndexStart + sortedGrouped.length + sortedUnGrouped.length - 1
    const groupedIndexStart = inboxIndexEnd + 2
    const groupedIndexEnd = groupedIndexStart + sortedGrouped.length - 1
    return {
      inboxIndexRange: [inboxIndexStart, inboxIndexEnd],
      feedsIndexRange: [feedsIndexStart, feedsIndexEnd],
      groupedIndexRange: [groupedIndexStart, groupedIndexEnd],
    }
  }, [inboxes.length, sortedGrouped.length, sortedUnGrouped.length])
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useEventCallback(() => {
    return subscriptionSyncService.refresh(view)
  })
  const scrollViewRef = useRegisterNavigationScrollView<FlashListRef<any> | null>(active)

  return (
    <TimelineSelectorList
      contentContainerClassName="pb-6"
      ref={scrollViewRef}
      onRefresh={() => {
        setRefreshing(true)
        onRefresh().finally(() => {
          setRefreshing(false)
        })
      }}
      isRefetching={refreshing}
      data={data}
      renderItem={ItemRender}
      keyExtractor={keyExtractor}
      extraData={extraData}
    />
  )
}
const ItemRender = ({
  item,
  index,
  extraData,
}: {
  item:
    | string
    | {
        category: string
        subscriptionIds: string[]
      }
  index: number
  extraData?: {
    inboxIndexRange: [number, number]
    feedsIndexRange: [number, number]
    groupedIndexRange: [number, number]
  }
}) => {
  if (typeof item === "string") {
    switch (item) {
      case "words.starred": {
        return <StarItem />
      }
      case "words.inbox": {
        if (!extraData) return null
        const { inboxIndexRange } = extraData
        if (inboxIndexRange[0] > inboxIndexRange[1]) return null
        return <SectionTitle transKey={item} />
      }
      case "words.feeds": {
        if (!extraData) return null
        const { feedsIndexRange } = extraData
        if (feedsIndexRange[0] > feedsIndexRange[1]) return null
        return <SectionTitle transKey={item} />
      }
      default: {
        if (!extraData) return null
        const { inboxIndexRange, feedsIndexRange } = extraData
        if (inboxIndexRange[0] <= index && index <= inboxIndexRange[1]) {
          const isFirst = index === inboxIndexRange[0]
          const isLast = index === inboxIndexRange[1]
          return <InboxItem id={item} isFirst={isFirst} isLast={isLast} />
        }
        if (feedsIndexRange[0] <= index && index <= feedsIndexRange[1]) {
          const isFirst = index === feedsIndexRange[0]
          const isLast = index === feedsIndexRange[1]
          return <SubscriptionItem id={item} isFirst={isFirst} isLast={isLast} />
        }
        return null
      }
    }
  }
  const { category, subscriptionIds } = item
  if (!extraData) return null
  const { feedsIndexRange } = extraData
  const isFirst = index === feedsIndexRange[0]
  const isLast = index === feedsIndexRange[1]
  return (
    <CategoryGrouped
      category={category}
      subscriptionIds={subscriptionIds}
      isFirst={isFirst}
      isLast={isLast}
    />
  )
}
const SectionTitle = ({ transKey }: { transKey: ParseKeys<"common"> }) => {
  const { t } = useTranslation("common")
  const readableContainerStyle = useReadableContainerStyle(760, GROUPED_LIST_MARGIN)
  return (
    <View
      style={[
        readableContainerStyle,
        {
          marginHorizontal: GROUPED_LIST_MARGIN,
          marginTop: GROUPED_SECTION_TOP_MARGIN,
          marginBottom: GROUPED_SECTION_BOTTOM_MARGIN,
          paddingHorizontal: GROUPED_LIST_ITEM_PADDING,
        },
      ]}
    >
      <Text className="text-secondary-label" ellipsizeMode="tail" numberOfLines={1}>
        {t(transKey)}
      </Text>
    </View>
  )
}
const StarItem = () => {
  const navigation = useNavigation()
  const { t } = useTranslation("common")
  return (
    <GroupedInsetListCard showSeparator={false} className="mt-4">
      <ItemPressable
        itemStyle={ItemPressableStyle.Grouped}
        onPress={() => {
          navigation.pushControllerView(FeedScreen, { type: "feed", id: FEED_COLLECTION_LIST })
        }}
        className="h-12 w-full flex-row items-center px-3"
      >
        <StarCuteFiIcon color="rgb(245, 158, 11)" height={20} width={20} />
        <Text
          className="ml-2 font-medium text-text"
          style={{
            marginLeft: GROUPED_ICON_TEXT_GAP,
          }}
        >
          {t("words.starred")}
        </Text>
      </ItemPressable>
    </GroupedInsetListCard>
  )
}
export const SubscriptionList = memo(SubscriptionListImpl)
