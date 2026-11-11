import { getEntry } from "@follow/store/entry/getter"
import { useEntryIdsByView } from "@follow/store/entry/hooks"
import { getFeedById } from "@follow/store/feed/getter"
import { useAllFeedSubscription, useCategories } from "@follow/store/subscription/hooks"
import type { IFuseOptions } from "fuse.js"
import Fuse from "fuse.js"
import { useMemo } from "react"

import { ROUTE_FEED_IN_FOLDER } from "~/constants"
import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"

/**
 * Generic search item interface
 */
export interface SearchItem {
  id: string
  title: string
  type: "feed" | "entry" | "category"
}

const fuseOptions: IFuseOptions<SearchItem> = {
  keys: ["title", "id"],
  threshold: 0.3,
  includeScore: true,
}

const getSearchItems = (
  categories: ReturnType<typeof useCategories>,
  subscriptions: ReturnType<typeof useAllFeedSubscription>,
  entryIds: ReturnType<typeof useEntryIdsByView>,
): SearchItem[] => {
  const categoryItems = (categories ?? [])
    .filter((category) => !!category && category.trim().length > 0)
    .map((category) => ({
      id: `${ROUTE_FEED_IN_FOLDER}${category}`,
      title: category,
      type: "category" as const,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))

  const feedItems = subscriptions.flatMap((subscription) => {
    const { feedId } = subscription
    if (!feedId) return []
    return {
      id: feedId,
      title: subscription.title || getFeedById(feedId)?.title || `Feed ${feedId}`,
      type: "feed" as const,
    }
  })

  // Recent entries of the view, which the store keeps loaded
  const entryItems = (entryIds ?? []).flatMap((entryId) => {
    const entry = getEntry(entryId)
    return entry ? { id: entryId, title: entry.title || "Untitled", type: "entry" as const } : []
  })

  return [...categoryItems, ...feedItems, ...entryItems]
}

/**
 * Hook that provides unified search functionality for feeds and entries
 * Used by both context bar and mention plugin. The items and their index are only built once a
 * search runs, so an idle chat input does no work when subscriptions or entries change.
 */
export const useFeedEntrySearchService = () => {
  const view = useRouteParamsSelector((route) => route.view)
  const allSubscriptions = useAllFeedSubscription()
  const categories = useCategories()
  const recentEntryIds = useEntryIdsByView(view)

  const search = useMemo(() => {
    let items: SearchItem[] | undefined
    let fuse: Fuse<SearchItem> | undefined
    const getItems = () => (items ??= getSearchItems(categories, allSubscriptions, recentEntryIds))

    const applyProportionalLimit = (results: SearchItem[], maxResults: number) => {
      const counts = { category: 0, feed: 0, entry: 0 }
      for (const item of getItems()) counts[item.type] += 1
      const total = getItems().length

      // Each type gets a share of the results as large as its share of all items
      const maxPerType = {
        category: Math.max(1, Math.floor((maxResults * counts.category) / total)),
        feed: Math.max(1, Math.floor((maxResults * counts.feed) / total)),
        entry: Math.max(1, Math.floor((maxResults * counts.entry) / total)),
      }

      const taken = { category: 0, feed: 0, entry: 0 }
      const limited: SearchItem[] = []
      for (const item of results) {
        if (limited.length >= maxResults) break
        if (taken[item.type] < maxPerType[item.type]) {
          limited.push(item)
          taken[item.type] += 1
        }
      }
      return limited
    }

    return (query: string, type?: "feed" | "entry" | "category", maxResults = 10): SearchItem[] => {
      const matchesType = (item: SearchItem) => {
        if (!type) return true
        if (type === "feed") return item.type === "feed" || item.type === "category"
        return item.type === type
      }

      // The proportional split balances a mixed search. With a type filter the other types are
      // gone, and their share would cap the results at one or two items.
      const limit = (results: SearchItem[]) =>
        type ? results.slice(0, maxResults) : applyProportionalLimit(results, maxResults)

      if (!query.trim()) {
        // If no query, return recent items of the specified type
        return limit(getItems().filter(matchesType))
      }

      fuse ??= new Fuse(getItems(), fuseOptions)
      return limit(
        fuse
          .search(query)
          .map((result) => result.item)
          .filter(matchesType),
      )
    }
  }, [allSubscriptions, categories, recentEntryIds])

  return { search }
}
