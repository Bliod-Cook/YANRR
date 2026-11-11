import { feedSyncServices } from "@follow/store/feed/store"
import { useMutation } from "@tanstack/react-query"

import { ROUTE_FEED_IN_FOLDER, ROUTE_FEED_PENDING } from "~/constants"
import { useAuthQuery } from "~/hooks/common"
import { followClient } from "~/lib/api-client"
import { defineQuery } from "~/lib/defineQuery"
import { toastFetchError } from "~/lib/error-parser"

type FeedQueryParams = { id?: string; url?: string }

export const feed = {
  byId: ({ id, url }: FeedQueryParams) =>
    defineQuery(["feed", id, url], async () =>
      feedSyncServices.fetchFeed({
        id,
        url,
      }),
    ),
}

export const useFeedQuery = ({ id, url }: FeedQueryParams) =>
  useAuthQuery(
    feed.byId({
      id,
      url,
    }),
    {
      enabled:
        (!!id || !!url) && id !== ROUTE_FEED_PENDING && !id?.startsWith(ROUTE_FEED_IN_FOLDER),
    },
  )

export const useRefreshFeedMutation = (feedId?: string) =>
  useMutation({
    mutationKey: ["refreshFeed", feedId],
    mutationFn: () => followClient.api.feeds.refresh({ id: feedId! }),
    async onError(err) {
      toastFetchError(err)
    },
  })
