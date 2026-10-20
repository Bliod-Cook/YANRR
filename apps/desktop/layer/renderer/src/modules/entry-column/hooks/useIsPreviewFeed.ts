import { getSubscriptionByFeedId } from "@follow/store/subscription/getter"
import { useSubscriptionStore } from "@follow/store/subscription/store"
import { isBizId } from "@follow/utils/utils"
import { useCallback } from "react"

import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"

const getPreviewFeedId = (feedId?: string) => (feedId && isBizId(feedId) ? feedId : undefined)

export const getIsPreviewFeed = ({ feedId }: { feedId?: string }) => {
  const previewFeedId = getPreviewFeedId(feedId)
  return !!previewFeedId && !getSubscriptionByFeedId(previewFeedId)
}

export const useIsPreviewFeed = () => {
  const feedId = useRouteParamsSelector((s) => s.feedId)
  const previewFeedId = getPreviewFeedId(feedId)

  // Subscribe to the store: on a cold start the subscriptions load after the
  // route is already set, and a memoized getter would keep treating the
  // subscribed feed as a preview.
  const isSubscribed = useSubscriptionStore(
    useCallback((state) => !!previewFeedId && !!state.data[previewFeedId], [previewFeedId]),
  )

  return !!previewFeedId && !isSubscribed
}
