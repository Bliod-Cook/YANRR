/**
 * An address typed to find or add a feed, with `https://` in front when it names no scheme, as
 * people paste `example.com/feed`. Path and query stay as typed. `null` when no host is left,
 * such as for `https://` alone.
 */
export const normalizeFeedAddress = (input: string): string | null => {
  const value = input.trim()
  const address = /^[a-z][\d+.a-z-]*:\/\//i.test(value) ? value : `https://${value}`
  try {
    return new URL(address).host ? address : null
  } catch {
    return null
  }
}
