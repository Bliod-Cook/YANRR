import { FeedViewType } from "@follow/constants"

import { ROUTE_FEED_IN_FOLDER } from "../../constants/app"
import type { SubscriptionState } from "./store"
import { getDefaultCategory } from "./utils"

export const categoryFeedIdsSelector =
  (folderName: string | undefined, view: FeedViewType) =>
  (state: SubscriptionState): string[] => {
    if (!folderName) return []

    const feedIds: string[] = []
    for (const feedId in state.data) {
      const subscription = state.data[feedId]
      if (!subscription) continue
      if (
        (subscription.view === view || view === FeedViewType.All) &&
        (subscription.category
          ? subscription.category === folderName
          : getDefaultCategory(subscription) === folderName)
      ) {
        feedIds.push(feedId)
      }
    }
    return feedIds
  }

export const folderFeedsByFeedIdSelector =
  (feedId: string | undefined, view: FeedViewType) =>
  (state: SubscriptionState): string[] =>
    feedId?.startsWith(ROUTE_FEED_IN_FOLDER)
      ? categoryFeedIdsSelector(feedId.slice(ROUTE_FEED_IN_FOLDER.length), view)(state)
      : []
