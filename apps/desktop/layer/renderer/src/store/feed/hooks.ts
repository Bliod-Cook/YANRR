import { getView } from "@follow/constants"
import type { EntryModel } from "@follow/store/entry/types"
import { useFeedById, usePrefetchFeed } from "@follow/store/feed/hooks"
import { feedIconSelector } from "@follow/store/feed/selectors"
import { getSubscriptionByFeedId } from "@follow/store/subscription/getter"
import { useTranslation } from "react-i18next"
import { useShallow } from "zustand/shallow"

import {
  FEED_COLLECTION_LIST,
  ROUTE_FEED_IN_FOLDER,
  ROUTE_FEED_IN_INBOX,
  ROUTE_FEED_PENDING,
} from "~/constants"
import { useRouteParams } from "~/hooks/biz/useRouteParams"

export type PreferredTitleTarget = {
  type: string
  id: string
  title?: Nullable<string>
  [key: string]: any
}
export const getPreferredTitle = (
  target?: PreferredTitleTarget,
  entry?: Pick<EntryModel, "authorUrl"> | null,
) => {
  if (!target?.id) {
    return target?.title
  }

  if (target.type === "inbox") {
    if (entry?.authorUrl) return entry.authorUrl.replace(/^mailto:/, "")
    return target.title || `${target.id.slice(0, 1).toUpperCase()}${target.id.slice(1)}'s Inbox`
  }

  const subscription = getSubscriptionByFeedId(target.id)
  return subscription?.title || target.title
}

export const useFeedHeaderTitle = () => {
  const { t } = useTranslation()
  const { feedId: currentFeedId, view } = useRouteParams()

  const feedTitle = useFeedById(currentFeedId, getPreferredTitle)

  usePrefetchFeed(currentFeedId, { enabled: !feedTitle })

  switch (currentFeedId) {
    case ROUTE_FEED_PENDING: {
      return t(getView(view).name, {
        ns: "common",
      })
    }
    case FEED_COLLECTION_LIST: {
      return t("words.starred")
    }
    default: {
      if (currentFeedId?.startsWith(ROUTE_FEED_IN_FOLDER)) {
        return currentFeedId.replace(ROUTE_FEED_IN_FOLDER, "")
      }
      if (currentFeedId?.startsWith(ROUTE_FEED_IN_INBOX)) {
        return currentFeedId.replace(ROUTE_FEED_IN_INBOX, "")
      }
      return feedTitle
    }
  }
}

export const useFeedHeaderIcon = () => {
  const { feedId: currentFeedId } = useRouteParams()

  return useFeedById(currentFeedId, useShallow(feedIconSelector))
}
