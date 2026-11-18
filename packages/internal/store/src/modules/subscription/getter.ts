import { FeedViewType } from "@follow/constants"
import { sortByAlphabet } from "@follow/utils/utils"

import { createStaticGetter } from "../../lib/helper"
import { getEntry } from "../entry/getter"
import { getFeedById } from "../feed/getter"
import { getInboxList } from "../inbox/getters"
import { getUnreadById } from "../unread/getters"
import { categoryFeedIdsSelector, folderFeedsByFeedIdSelector } from "./selectors"
import { useSubscriptionStore } from "./store"
import { getDefaultCategory } from "./utils"

export const getSubscriptionById = (id: string | undefined) => {
  if (!id) return
  return useSubscriptionStore.getState().data[id]
}
export const getSubscriptionByFeedId = (feedId: string | undefined) => getSubscriptionById(feedId)

export const getSubscriptionByEntryId = (entryId: string | undefined) => {
  if (!entryId) return
  const entry = getEntry(entryId)
  if (!entry) return
  return getSubscriptionByFeedId(entry.feedId ?? undefined)
}

export const getSubscribedFeedIdAndInboxHandlesByView = ({
  view,
  excludeHidden,
}: {
  view: FeedViewType | undefined
  excludeHidden: boolean
}): string[] => {
  if (typeof view !== "number") return []
  const state = useSubscriptionStore.getState()

  const feedIds = Array.from(state.feedIdByView[view] ?? []).filter(
    (i) => !excludeHidden || !state.data[i]?.hideFromTimeline,
  )

  const inboxIds =
    view === FeedViewType.Articles || view === FeedViewType.All
      ? getInboxList().map((i) => i.id)
      : []

  return [...feedIds, ...inboxIds]
}

export const getSubscriptionByCategory = ({
  category,
  view,
}: {
  category: string
  view: FeedViewType
}): string[] => {
  const state = useSubscriptionStore.getState()

  const ids = [] as string[]
  for (const id of Object.keys(state.data)) {
    const subscriptionCategory = state.data[id]
      ? state.data[id].category || getDefaultCategory(state.data[id])
      : null
    if (subscriptionCategory === category && state.data[id]!.view === view) {
      ids.push(id)
    }
  }
  return ids
}

export const getCategoryFeedIds = (category: string | undefined, view: FeedViewType) =>
  categoryFeedIdsSelector(category, view)(useSubscriptionStore.getState())

export const getRouteFolderFeedIds = (feedId: string | undefined, view: FeedViewType) =>
  folderFeedsByFeedIdSelector(feedId, view)(useSubscriptionStore.getState())

// Utility functions for creating getters
type StateType = ReturnType<typeof useSubscriptionStore.getState>
const getState = () => useSubscriptionStore.getState()

// Helper functions for sorting
const sortUngroupedSubscriptionByAlphabet = (
  leftSubscriptionId: string,
  rightSubscriptionId: string,
) => {
  const leftSubscription = getSubscriptionById(leftSubscriptionId)
  const rightSubscription = getSubscriptionById(rightSubscriptionId)

  if (!leftSubscription || !rightSubscription) return 0

  if (!leftSubscription.feedId || !rightSubscription.feedId) return 0
  const leftFeed = getFeedById(leftSubscription.feedId)
  const rightFeed = getFeedById(rightSubscription.feedId)

  if (!leftFeed || !rightFeed) return 0

  const comparedLeftTitle = leftSubscription.title ?? leftFeed.title ?? ""
  const comparedRightTitle = rightSubscription.title ?? rightFeed.title ?? ""

  return sortByAlphabet(comparedLeftTitle, comparedRightTitle)
}

const sortByUnread = (leftSubscriptionId: string, rightSubscriptionId: string) => {
  const leftSubscription = getSubscriptionById(leftSubscriptionId)
  const rightSubscription = getSubscriptionById(rightSubscriptionId)

  const leftFeedId = leftSubscription?.feedId
  const rightFeedId = rightSubscription?.feedId

  if (!leftFeedId || !rightFeedId) return 0
  return getUnreadById(rightFeedId) - getUnreadById(leftFeedId)
}

// Store selector functions (for React hooks)
export const getSubscriptionIdsByViewSelector = (state: StateType) => (view: FeedViewType) => {
  const feedIds = Array.from(state.feedIdByView[view] ?? [])
  const inboxIds =
    view === FeedViewType.Articles || view === FeedViewType.All
      ? getInboxList().map((i) => i.id)
      : []

  return [...feedIds, ...inboxIds]
}

export const getFeedSubscriptionIdsByViewSelector =
  (state: StateType) => (view: FeedViewType | undefined) => {
    return typeof view === "number" ? Array.from(state.feedIdByView[view] ?? []) : []
  }

export const getFeedSubscriptionByViewSelector = (state: StateType) => (view: FeedViewType) => {
  return Array.from(state.feedIdByView[view] ?? [])
    .map((feedId) => state.data[feedId])
    .filter((feed) => !!feed)
}

export const getGroupedSubscriptionSelector =
  (state: StateType) =>
  ({ view, autoGroup }: { view: FeedViewType; autoGroup: boolean }) => {
    const feedIds = state.feedIdByView[view] ?? []

    const grouped = {} as Record<string, string[]>
    const unGrouped = [] as string[]

    const autoGrouped = {} as Record<string, string[]>

    for (const feedId of feedIds) {
      const subscription = state.data[feedId]
      if (!subscription) continue
      const { category } = subscription
      if (!category) {
        const defaultCategory = getDefaultCategory(subscription)
        if (defaultCategory && autoGroup) {
          if (!autoGrouped[defaultCategory]) {
            autoGrouped[defaultCategory] = []
          }
          autoGrouped[defaultCategory].push(feedId)
        } else {
          unGrouped.push(feedId)
        }
        continue
      }
      if (!grouped[category]) {
        grouped[category] = []
      }
      grouped[category].push(feedId)
    }

    if (autoGroup) {
      for (const category of Object.keys(autoGrouped)) {
        if (autoGrouped[category] && autoGrouped[category].length > 1) {
          grouped[category] = autoGrouped[category]
        } else {
          unGrouped.push(...autoGrouped[category]!)
        }
      }
    }

    return {
      grouped,
      unGrouped,
    }
  }

export const getSortedGroupedSubscriptionSelector =
  (_state: StateType) =>
  ({
    grouped,
    sortBy,
    sortOrder,
    hideAllReadSubscriptions,
  }: {
    view: FeedViewType
    grouped: Record<string, string[]>
    sortBy: "alphabet" | "count"
    sortOrder: "asc" | "desc"
    hideAllReadSubscriptions: boolean
  }) => {
    const categories = Object.keys(grouped)
    // The folder totals come from the ids already grouped, once per folder rather than once per
    // comparison
    const unreadTotals = new Map(
      categories.map((category) => [
        category,
        grouped[category]!.reduce((acc, id) => acc + getUnreadById(id), 0),
      ]),
    )
    const sortedCategories = categories.sort((a, b) => {
      const result =
        sortBy === "alphabet" ? sortByAlphabet(a, b) : unreadTotals.get(a)! - unreadTotals.get(b)!
      return sortOrder === "asc" ? result : -result
    })
    const sortedList = [] as { category: string; subscriptionIds: string[] }[]
    for (const category of sortedCategories) {
      if (!hideAllReadSubscriptions || grouped[category]?.some((id) => getUnreadById(id) > 0)) {
        sortedList.push({ category, subscriptionIds: grouped[category]! })
      }
    }
    return sortedList
  }

export const getSortedUngroupedSubscriptionSelector =
  (_state: StateType) =>
  ({
    ids,
    sortBy,
    sortOrder,
    hideAllReadSubscriptions,
  }: {
    ids: string[]
    sortBy: "alphabet" | "count"
    sortOrder: "asc" | "desc"
    hideAllReadSubscriptions: boolean
  }) => {
    return ids
      .filter((id) => {
        return !hideAllReadSubscriptions || getUnreadById(id) > 0
      })
      .sort((a, b) => {
        const sortMethod =
          sortBy === "alphabet" ? sortUngroupedSubscriptionByAlphabet : sortByUnread
        const result = sortMethod(a, b)
        return sortOrder === "asc" ? result : -result
      })
  }

export const getSortedFeedSubscriptionByAlphabetSelector =
  (_state: StateType) => (ids: string[]) => {
    return ids.sort((a, b) => {
      const leftFeed = getFeedById(a)
      const rightFeed = getFeedById(b)
      if (!leftFeed || !rightFeed) return 0
      return sortByAlphabet(leftFeed.title ?? "", rightFeed.title ?? "")
    })
  }

export const getSubscriptionByIdSelector =
  (state: StateType) => (id: string | undefined | null) => {
    return id ? state.data[id] : undefined
  }

export const getSubscriptionsByIdsSelector = (state: StateType) => (ids: string[]) => {
  return ids.map((id) => state.data[id])
}

export const getFeedSubscriptionSelector = (state: StateType) => (view: FeedViewType) => {
  return Array.from(state.feedIdByView[view] ?? []).map((feedId) => state.data[feedId])
}

export const getFeedSubscriptionIdsSelector = (state: StateType) => (view: FeedViewType) => {
  return Array.from(state.feedIdByView[view] ?? [])
}

export const getAllFeedSubscriptionSelector = (state: StateType) => () => {
  return Array.from(
    new Set(Object.values(state.feedIdByView).flatMap((feedId) => Array.from(feedId))),
  )
    .map((id) => state.data[id])
    .filter((feed) => !!feed)
}

export const getAllFeedSubscriptionIdsSelector = (state: StateType) => () => {
  return Array.from(
    new Set(Object.values(state.feedIdByView).flatMap((feedId) => Array.from(feedId))),
  )
}

export const getAllSubscriptionSelector = (state: StateType) => () => {
  return Object.values(state.data).filter((subscription) => !!subscription)
}

/**
 * The named folders of a view, or of every view for `undefined` and for the All view, which
 * merges the folders of the same name.
 */
export const getCategoriesByViewSelector = (state: StateType) => (view?: FeedViewType) => {
  const categories = new Set<string>()
  for (const subscription of Object.values(state.data)) {
    if (!subscription.category) continue
    if (view === undefined || view === FeedViewType.All || subscription.view === view) {
      categories.add(subscription.category)
    }
  }
  return categories
}

export const getCategoriesSelector = (state: StateType) => (view?: FeedViewType) =>
  Array.from(getCategoriesByViewSelector(state)(view))

export const getSubscriptionCategoryExistSelector =
  (state: StateType) => (categoryId: string | undefined | null) =>
    !!categoryId && Object.values(state.data).some((s) => s.category === categoryId)

export const getFeedSubscriptionCountSelector = (state: StateType) => () => {
  return Array.from(state.subscriptionIdSet).filter((id) => id.startsWith("feed/")).length
}

export const getIsSubscribedSelector = (state: StateType) => (id: string | undefined) => {
  if (!id) return false
  return (
    state.subscriptionIdSet.has(id) ||
    state.subscriptionIdSet.has(`feed/${id}`) ||
    state.subscriptionIdSet.has(`inbox/${id}`)
  )
}

export const getCategoryOpenStateByViewSelector = (state: StateType) => (view: FeedViewType) => {
  return state.categoryOpenStateByView[view]
}

export const getAllFeedSubscription = createStaticGetter(getState, getAllFeedSubscriptionSelector)
