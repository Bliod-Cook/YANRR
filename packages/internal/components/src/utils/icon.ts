import { getUrlIcon } from "@follow/utils/utils"

export const getFeedIconSrc = ({
  src,
  siteUrl,
  fallback,
}: {
  src?: string
  siteUrl?: string
  fallback?: boolean
} = {}) => {
  if (src) {
    return [src, ""]
  }
  if (!siteUrl) return ["", ""]
  const ret = getUrlIcon(siteUrl, fallback)

  return [ret.src, ret.fallbackUrl]
}
