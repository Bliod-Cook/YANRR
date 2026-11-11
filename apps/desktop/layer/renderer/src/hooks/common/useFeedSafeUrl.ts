import { useEntry } from "@follow/store/entry/hooks"
import { useFeedById } from "@follow/store/feed/hooks"
import { useIsInbox } from "@follow/store/inbox/hooks"
import { useMemo } from "react"

/**
 * The web page of the entry, to open or to embed. Never another scheme, such as the `mailto:`
 * author of an inbox email, which an embed would not show either.
 */
export const useFeedSafeUrl = (entryId: string): string | null => {
  const entry = useEntry(entryId, (state) => {
    return {
      feedId: state.feedId,
      inboxId: state.inboxHandle,
      url: state.url,
      authorUrl: state.authorUrl,
    }
  })

  const feed = useFeedById(entry?.feedId, (feed) => ({
    type: feed?.type,
    siteUrl: feed?.siteUrl,
  }))
  const isInbox = useIsInbox(entry?.inboxId)

  return useMemo(() => {
    const href = isInbox ? entry?.authorUrl : entry?.url
    if (!href) return null

    // A relative link of a feed entry points into the site of the feed
    const base = !isInbox && feed?.type === "feed" ? feed.siteUrl : null
    let url: URL
    try {
      url = new URL(href, base ?? undefined)
    } catch {
      return null
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.hostname === "localhost") return null
    return url.href
  }, [entry?.authorUrl, entry?.url, feed?.type, feed?.siteUrl, isInbox])
}
