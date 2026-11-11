import { getFeedByIdOrUrl } from "@follow/store/feed/getter"
import { getSubscriptionByFeedId } from "@follow/store/subscription/getter"
import { t } from "i18next"
import { useCallback } from "react"
import { useNavigate } from "react-router"
import { withoutTrailingSlash, withTrailingSlash } from "ufo"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { FeedForm } from "~/modules/discover/FeedForm"

import { getPreviewBackPath } from "./useNavigateEntry"

export interface FollowOptions {
  id?: string
  url?: string

  onSuccess?: () => void
}
export const useFollow = () => {
  const { present } = useModalStack()
  const navigate = useNavigate()

  return useCallback(
    (options?: FollowOptions) => {
      // Some feeds redirect xxx.com/feed to xxx.com/feed/
      // Try to get a valid feed, then we can check isFollowed correctly
      const feed =
        getFeedByIdOrUrl({ id: options?.id, url: withTrailingSlash(options?.url) }) ??
        getFeedByIdOrUrl({ id: options?.id, url: withoutTrailingSlash(options?.url) })
      const id = options?.id || feed?.id
      const url = feed?.type === "feed" ? feed.url : options?.url
      const subscription = getSubscriptionByFeedId(id)
      const isFollowed = !!subscription

      present({
        title: isFollowed ? t("sidebar.feed_actions.edit_feed") : t("feed_form.add_feed"),
        modalContentClassName: "overflow-visible",
        content: ({ dismiss }) => {
          const onSuccess = () => {
            options?.onSuccess?.()
            // Followed from its preview: back to where the preview was opened from
            const backPath = getPreviewBackPath()
            if (backPath) void navigate(backPath)
            dismiss()
          }
          return <FeedForm id={id} url={url} onSuccess={onSuccess} />
        },
      })
    },
    [present],
  )
}
