import type { FeedModel } from "./types"

export const feedIconSelector = (feed: FeedModel) => {
  return {
    type: feed.type,
    id: feed.id,
    title: feed.title,
    url: (feed as any).url || "",
    image: feed.image,
    siteUrl: feed.siteUrl,
  }
}
