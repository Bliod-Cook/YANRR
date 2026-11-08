/**
 * The address of a server as the user typed it: HTTPS unless another scheme is given, and a path
 * stays, since a server may be hosted under one. Null for anything that is no web address.
 */
export const normalizeServerUrl = (input: string): string | null => {
  const trimmed = input.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(/^[a-z][\d+.a-z-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

/** The server serves its API under `/api` */
export const getApiUrl = (server: string) => `${server}/api`

/** Where the server looks up the icon of the site at `siteUrl`; an empty 404 means the site has none */
export const getSiteIconUrl = (apiUrl: string, siteUrl: string): string | undefined => {
  try {
    return `${apiUrl}/icons/${new URL(siteUrl).hostname}`
  } catch {
    return undefined
  }
}
