/**
 * An address typed to find or add a feed, by the rule the server discovers feeds by: an RSSHub
 * route, or a web address whose host has a dot. Without a scheme it is taken as `https://`, as
 * people paste `example.com/feed`; path and query stay as typed. `null` for anything else, at
 * which the server would find nothing.
 */
export const normalizeFeedAddress = (input: string): string | null => {
  const value = input.trim()
  const address = value.includes("://") ? value : `https://${value}`
  try {
    const { protocol, host, hostname } = new URL(address)
    const isFeedAddress =
      protocol === "rsshub:"
        ? host !== ""
        : (protocol === "http:" || protocol === "https:") && hostname.includes(".")
    return isFeedAddress ? address : null
  } catch {
    return null
  }
}
