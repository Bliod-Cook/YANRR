import { getSiteIconUrl } from "@follow/utils/server-url"

import type { FeedIconFeed } from "../components/ui/icon/feed-icon"
import { serverEnv } from "./server-env"

/** The feed's image, else the icon of its site, or of `siteUrl` without a feed */
export const getFeedIconSource = (feed?: FeedIconFeed, siteUrl?: string): string | undefined => {
  if (feed?.image) return feed.image
  const site = feed ? feed.siteUrl : siteUrl
  return site ? getSiteIconUrl(serverEnv.API_URL, site) : undefined
}

/** Images load over HTTPS, except the server's own, which a home network serves without it */
export const toSecureImageUrl = (url: string) =>
  serverEnv.API_URL && url.startsWith(serverEnv.API_URL) ? url : url.replace("http://", "https://")
