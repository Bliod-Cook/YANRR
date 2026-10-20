import type { RSSHubParameter, RSSHubParameterObject } from "@follow/models/rsshub"
import type { DiscoveryItem } from "@follow-app/client-sdk"

export const normalizeRSSHubParameters = (
  parameters: RSSHubParameter,
): RSSHubParameterObject | null =>
  parameters
    ? typeof parameters === "string"
      ? { description: parameters, default: null }
      : parameters
    : null

/**
 * Whether discovering `url` left nothing to choose from: it found no feed, or only the feed at
 * `url` itself. The feed at `url` is then previewed directly.
 */
export const isDiscoveredFeedItself = (items: DiscoveryItem[], url: string) =>
  items.length === 0 || (items.length === 1 && items[0]?.feed?.url === url)
