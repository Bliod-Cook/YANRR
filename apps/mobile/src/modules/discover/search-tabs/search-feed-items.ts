import { normalizeFeedAddress } from "@follow/utils/feed-address"

import type { SearchFeedCardItem } from "./SearchFeedCard"

/** Discovery takes addresses only, such as feed and site URLs and RSSHub routes */
export const isDirectFeedInput = (value: string) => normalizeFeedAddress(value) !== null

export const resolveSearchFeedItems = <T extends SearchFeedCardItem>(
  discoveredItems: readonly T[],
  searchValue: string,
): readonly (T | SearchFeedCardItem)[] => {
  if (discoveredItems.length > 0) {
    return discoveredItems
  }

  const url = normalizeFeedAddress(searchValue)
  if (!url) {
    return []
  }

  return [
    {
      feed: {
        title: searchValue,
        url,
      },
    },
  ]
}
