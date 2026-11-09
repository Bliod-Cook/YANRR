export interface SearchableFeed {
  id: string
  names: string[]
  addresses: string[]
}

/** The feeds with `keyword` in a name or address, ignoring case; those with a name starting with it come first */
export function matchFeeds(keyword: string, feeds: SearchableFeed[]): SearchableFeed[] {
  const needle = keyword.toLowerCase()
  const matching = feeds.filter((feed) =>
    [...feed.names, ...feed.addresses].some((text) => text.toLowerCase().includes(needle)),
  )
  const leads = (feed: SearchableFeed) =>
    feed.names.some((name) => name.toLowerCase().startsWith(needle))
  return [...matching.filter(leads), ...matching.filter((feed) => !leads(feed))]
}
