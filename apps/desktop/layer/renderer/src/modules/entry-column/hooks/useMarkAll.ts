import type { FeedViewType } from "@follow/constants"
import { getCategoryFeedIds } from "@follow/store/subscription/getter"
import { unreadSyncService } from "@follow/store/unread/store"

export type MarkAllFilter =
  | {
      startTime: number
      endTime: number
    }
  | {
      insertedBefore: number
    }

export const markAllByRoute = async (
  data: {
    feedId?: string | undefined
    view: FeedViewType
    inboxId?: string | undefined

    isAllFeeds?: boolean
  },
  time?: MarkAllFilter,
) => {
  const { feedId, view, inboxId, isAllFeeds } = data
  const folderIds = getCategoryFeedIds(feedId, view)

  if (!feedId) return

  if (typeof feedId === "number" || isAllFeeds) {
    unreadSyncService.markBatchAsRead({
      view,
      time,
    })
  } else if (inboxId) {
    unreadSyncService.markBatchAsRead({
      filter: {
        inboxId,
      },
      view,
      time,
    })
  } else if (folderIds?.length) {
    unreadSyncService.markBatchAsRead({
      filter: {
        feedIdList: folderIds,
      },
      view,
      time,
    })
  } else if (feedId) {
    unreadSyncService.markBatchAsRead({
      filter: {
        feedIdList: feedId?.split(","),
      },
      view,
      time,
    })
  }
}
