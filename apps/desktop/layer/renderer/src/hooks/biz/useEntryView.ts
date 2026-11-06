import type { FeedViewType } from "@follow/constants"
import { useEntry } from "@follow/store/entry/hooks"
import { useSubscriptionByFeedId } from "@follow/store/subscription/hooks"

import { useRouteParamsSelector } from "./useRouteParams"

/** The view of the entry's subscription, or of the route for an entry without one */
export const useEntryView = (entryId: string): FeedViewType => {
  const feedId = useEntry(entryId, (state) => state.feedId)
  const subscriptionView = useSubscriptionByFeedId(feedId)?.view
  const routeView = useRouteParamsSelector((route) => route.view)
  return subscriptionView ?? routeView
}
