import imageRequest from "./image-request.json"

/** Image hosts that refuse hotlinking, and the Referer they accept. The image proxy reads the same file. */
export const imageRefererMatches = imageRequest.referers.map(({ url, referer }) => ({
  url: new RegExp(url),
  referer,
}))

/** A browser's User-Agent, which some image hosts want */
export const imageUserAgent = imageRequest.userAgent
