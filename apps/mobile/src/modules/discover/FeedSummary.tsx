import { FeedViewType } from "@follow/constants"
import { useMemo } from "react"
import { View } from "react-native"

import { FeedIcon } from "@/src/components/ui/icon/feed-icon"
import { ItemPressableStyle } from "@/src/components/ui/pressable/enum"
import { ItemPressable } from "@/src/components/ui/pressable/ItemPressable"
import { Text } from "@/src/components/ui/typography/Text"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { FollowScreen } from "@/src/screens/(modal)/FollowScreen"

import { getFeedDescriptionText } from "./feed-description"

type FeedSummaryFeed = {
  id: string
  title?: Nullable<string>
  url?: Nullable<string>
  image?: Nullable<string>
  siteUrl?: Nullable<string>
  description?: Nullable<string>

  [key: string]: any
}

export const FeedSummary = ({
  feed,
  children,
  className,
  testID,
}: {
  feed: FeedSummaryFeed
  children?: React.ReactNode
  className?: string
  testID?: string
}) => {
  const navigation = useNavigation()
  const description = useMemo(
    () => (feed.description ? getFeedDescriptionText(feed.description) : ""),
    [feed.description],
  )
  return (
    <ItemPressable
      itemStyle={ItemPressableStyle.UnStyled}
      onPress={() => {
        navigation.presentControllerView(FollowScreen, {
          id: feed.id,
          type: "feed",
        })
      }}
      className={className}
      testID={testID}
    >
      {/* Headline */}
      <View className="flex-1 flex-row items-center gap-2 pr-2">
        <View className="size-[32px] overflow-hidden rounded-lg">
          <FeedIcon
            size={32}
            feed={
              feed
                ? {
                    id: feed.id,
                    title: feed.title!,
                    url: feed.url!,
                    image: feed.image!,
                    siteUrl: feed.siteUrl!,
                    type: FeedViewType.Articles,
                  }
                : undefined
            }
          />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-text" numberOfLines={1}>
            {feed.title}
          </Text>
          <Text className="text-xs leading-tight text-text opacity-60" numberOfLines={1}>
            {feed.url}
          </Text>
        </View>
      </View>
      {!!description && (
        <Text
          className="mt-3 pl-[39] pr-2 text-subheadline text-text"
          ellipsizeMode="tail"
          numberOfLines={2}
        >
          {description}
        </Text>
      )}

      {children}
    </ItemPressable>
  )
}
