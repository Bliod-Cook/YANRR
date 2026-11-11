const parseHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * An address from entry content, made absolute against the page it came from (the entry's URL,
 * else the feed's site). Without such a base a relative address would point at the app itself,
 * so it is dropped. The base comes from the feed too, hence only http(s) bases count.
 */
export const resolveContentUrl = (url: string, base: string | null | undefined) => {
  try {
    return new URL(url, base ? parseHttpUrl(base) : undefined).href
  } catch {
    return undefined
  }
}
