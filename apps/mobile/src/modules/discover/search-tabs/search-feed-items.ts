import type { SearchFeedCardItem } from "./SearchFeedCard"

/** Discovery takes addresses only, such as feed and site URLs and RSSHub routes */
export const isDirectFeedInput = (value: string) => value.includes("://")

export const resolveSearchFeedItems = <T extends SearchFeedCardItem>(
  discoveredItems: readonly T[],
  searchValue: string,
): readonly (T | SearchFeedCardItem)[] => {
  if (discoveredItems.length > 0) {
    return discoveredItems
  }

  if (!searchValue || !isDirectFeedInput(searchValue)) {
    return []
  }

  return [
    {
      feed: {
        title: searchValue,
        url: searchValue,
      },
    },
  ]
}
