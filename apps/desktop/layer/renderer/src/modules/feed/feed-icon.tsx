// import { Avatar, AvatarFallback, AvatarImage } from "@follow/components/ui/avatar/index.jsx"
import { PlatformIcon } from "@follow/components/ui/platform-icon/index.jsx"
import { env } from "@follow/shared/env.desktop"
import type { FeedModel } from "@follow/store/feed/types"
import { getBackgroundGradient } from "@follow/utils/color"
import { LRUCache } from "@follow/utils/lru-cache"
import { getSiteIconUrl } from "@follow/utils/server-url"
import { cn } from "@follow/utils/utils"
import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { m } from "motion/react"
import type { ReactNode } from "react"
import { useEffect, useMemo } from "react"

const { Avatar, AvatarFallback, AvatarImage } = AvatarPrimitive

// Size-responsive border radius utility function
const getBorderRadius = (size: number) => {
  if (size <= 24) return "rounded-sm" // 2px for small avatars
  if (size <= 32) return "rounded-md" // 6px for medium avatars
  if (size <= 48) return "rounded-lg" // 8px for large avatars
  return "rounded-xl" // 12px for extra large avatars
}

type GetIconPropsProps = {
  target?: IconTarget | null
  entry?: FeedIconEntry | null
  useMedia?: boolean
  siteUrl?: string
  fallbackUrl?: string
}

const getSiteIconProps = (siteUrl: string) => {
  const src = getSiteIconUrl(env.VITE_API_URL, siteUrl)
  return src ? { type: "image" as const, src, platformUrl: siteUrl } : { type: "text" as const }
}

function getIconProps(props: GetIconPropsProps) {
  const { target, entry, useMedia, siteUrl: propSiteUrl, fallbackUrl } = props
  const image =
    (useMedia ? entry?.firstPhotoUrl || entry?.authorAvatar : entry?.authorAvatar) || target?.image
  const siteUrl = (target as FeedModel)?.siteUrl || fallbackUrl

  if (propSiteUrl && !target) {
    return getSiteIconProps(propSiteUrl)
  }
  if (image) {
    return {
      type: "image" as const,
      src: image,
      platformUrl: image,
    }
  }

  if (siteUrl) {
    return getSiteIconProps(siteUrl)
  }
  if (target?.type === "inbox") {
    return {
      type: "inbox" as const,
    }
  }

  if (target?.title) {
    return {
      type: "text" as const,
    }
  }

  return {
    type: "default" as const,
  }
}

/** The first letter of the site's domain, for sites known only by their address */
const getSiteInitial = (siteUrl: string) => {
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "")[0]?.toUpperCase()
  } catch {
    return undefined
  }
}

type IconTarget = {
  title?: Nullable<string>
  image?: Nullable<string>
  siteUrl?: Nullable<string>
  type: "feed" | "inbox"
  entry?: FeedIconEntry | null
  useMedia?: boolean
  feed?: FeedModel | null
  fallbackUrl?: string
  fallback?: boolean
  size?: number
}

export type FeedIconEntry = { authorAvatar?: string | null; firstPhotoUrl?: string | null }
const fadeInVariant = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
}

// Icons shown before skip the fade-in; bounded, as feeds come and go
const shownIcons = new LRUCache<string, true>(500)
export function FeedIcon({
  target,
  entry,
  fallbackUrl,
  className,
  size = 20,
  fallback = true,
  fallbackElement,
  siteUrl,
  useMedia,
  disableFadeIn,
  noMargin,
}: {
  target?: IconTarget | null
  entry?: FeedIconEntry | null
  fallbackUrl?: string
  className?: string
  size?: number
  siteUrl?: string
  /**
   * Image loading error fallback to site icon
   */
  fallback?: boolean
  fallbackElement?: ReactNode

  useMedia?: boolean
  disableFadeIn?: boolean
  noMargin?: boolean
}) {
  const marginClassName = cn(noMargin ? "" : "mr-2", className)
  const iconProps = getIconProps({
    target,
    entry,
    useMedia,
    siteUrl,
    fallbackUrl,
  })

  const colors = useMemo(
    () => getBackgroundGradient(target?.title || (target as FeedModel)?.url || siteUrl || ""),
    [target?.title, (target as FeedModel)?.url, siteUrl],
  )

  const sizeStyle: React.CSSProperties = useMemo(
    () => ({
      width: size,
      height: size,
    }),
    [size],
  )
  const colorfulStyle: React.CSSProperties = useMemo(() => {
    const [, , , bgAccent, bgAccentLight, bgAccentUltraLight] = colors
    return {
      backgroundImage: `linear-gradient(to top, ${bgAccent} 0%, ${bgAccentLight} 99%, ${bgAccentUltraLight} 100%)`,

      ...sizeStyle,
    }
  }, [colors, sizeStyle])

  const textFallbackIcon = (
    <span
      style={colorfulStyle}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-sm",
        "text-white",
        marginClassName,
      )}
    >
      <span
        style={{
          fontSize: size / 2,
        }}
      >
        {target?.title ? target.title[0] : siteUrl && getSiteInitial(siteUrl)}
      </span>
    </span>
  )

  let imageElement: ReactNode
  let finalSrc = ""

  switch (iconProps.type) {
    case "image": {
      finalSrc = iconProps.src
      const isIconLoaded = shownIcons.get(finalSrc) !== undefined

      imageElement = (
        <PlatformIcon url={iconProps.platformUrl} style={sizeStyle} className={className}>
          <m.img
            className={marginClassName}
            style={sizeStyle}
            initial={disableFadeIn || isIconLoaded ? false : fadeInVariant.initial}
            animate={fadeInVariant.animate}
          />
        </PlatformIcon>
      )
      break
    }
    case "inbox": {
      imageElement = (
        <i className={cn("i-mgc-inbox-cute-fi shrink-0", marginClassName)} style={sizeStyle} />
      )
      break
    }
    case "text": {
      imageElement = textFallbackIcon
      break
    }
    case "default": {
      imageElement = (
        <i className={cn("i-mgc-link-cute-re shrink-0", marginClassName)} style={sizeStyle} />
      )
      break
    }
  }

  // Written after the commit, as rendering must not change what the next render reads
  useEffect(() => {
    if (finalSrc) shownIcons.put(finalSrc, true)
  }, [finalSrc])

  if (!imageElement) {
    return null
  }

  const fallbackIcon = fallbackElement || textFallbackIcon

  if (finalSrc) {
    return (
      <Avatar className={cn("shrink-0 [&_*]:select-none", marginClassName)} style={sizeStyle}>
        <AvatarImage className={cn("object-cover", getBorderRadius(size))} asChild src={finalSrc}>
          {imageElement}
        </AvatarImage>
        <AvatarFallback delayMs={200} asChild>
          {fallback ? fallbackIcon : <div />}
        </AvatarFallback>
      </Avatar>
    )
  }

  return imageElement
}
