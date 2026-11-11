import { IN_ELECTRON } from "@follow/shared/constants"
import type { FC } from "react"

const isHttpUrl = (src: string) => {
  try {
    const { protocol } = new URL(src)
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/**
 * The page a video entry embeds, which may come from the feed itself, so it only loads over
 * http(s) and runs sandboxed.
 */
export const VideoPreview: FC<{ src: string; className?: string }> = ({ src, className }) => {
  if (!isHttpUrl(src)) return null

  if (IN_ELECTRON) {
    return (
      <webview
        src={src}
        // `webview` has no `sandbox` attribute; this is its equivalent
        webpreferences="sandbox=yes"
        className={className}
      />
    )
  }
  return (
    <iframe
      src={src}
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      className={className}
    />
  )
}
