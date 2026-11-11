import { useSubscriptionByFeedId } from "@follow/store/subscription/hooks"
import type { DiscoveryItem } from "@follow-app/client-sdk"
import { useTranslation } from "react-i18next"
import { Pressable, View } from "react-native"

import { Text } from "@/src/components/ui/typography/Text"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { FollowScreen } from "@/src/screens/(modal)/FollowScreen"

import { FeedSummary } from "../FeedSummary"

export const SearchFeedCard = ({ feed }: { feed: NonNullable<DiscoveryItem["feed"]> }) => {
  const { t } = useTranslation("common")
  const isSubscribed = useSubscriptionByFeedId(feed.id)
  const navigation = useNavigation()
  const openFollow = () => {
    navigation.presentControllerView(FollowScreen, {
      id: feed.id,
      type: "feed",
    })
  }
  return (
    <FeedSummary feed={feed} className="py-4 pl-4" testID="discover-feed-card">
      <View className="mr-4 mt-4 flex-row justify-end">
        {isSubscribed ? (
          <Pressable hitSlop={10} onPress={openFollow} testID="discover-feed-follow-action">
            <View className="px-5 py-2">
              <Text className="text-sm font-bold text-tertiary-label">
                {t("feed.actions.followed")}
              </Text>
            </View>
          </Pressable>
        ) : (
          <Pressable hitSlop={10} onPress={openFollow} testID="discover-feed-follow-action">
            <View className="rounded-full bg-accent px-5 py-2">
              <Text className="text-sm font-bold text-white">{t("feed.actions.follow")}</Text>
            </View>
          </Pressable>
        )}
      </View>
    </FeedSummary>
  )
}
