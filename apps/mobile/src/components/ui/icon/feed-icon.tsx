import type { FeedViewType } from "@follow/constants"
import type { FeedSchema } from "@follow/database/schemas/types"
import { cn } from "@follow/utils"
import { useRecyclingState } from "@shopify/flash-list"
import { useCallback, useMemo } from "react"

import { getFeedIconSource } from "@/src/lib/image"

import type { ImageProps } from "../image/Image"
import { Image } from "../image/Image"
import { FallbackIcon } from "./fallback-icon"

export type FeedIconRequiredFeed = Pick<
  FeedSchema,
  "ownerUserId" | "id" | "title" | "url" | "image"
> & {
  type: FeedViewType
  siteUrl?: string
}
export type FeedIconFeed = FeedIconRequiredFeed | FeedSchema

interface FeedIconProps {
  feed?: FeedIconFeed
  className?: string
  size?: number
  siteUrl?: string
}
export function FeedIcon({
  feed,
  className,
  size = 20,
  siteUrl,
  ...props
}: FeedIconProps & ImageProps) {
  const src = useMemo(() => getFeedIconSource(feed, siteUrl), [feed, siteUrl])
  // Lists recycle rows for other feeds, whose icons may load fine
  const [isError, setIsError] = useRecyclingState(false, [src])

  const handleError = useCallback(() => setIsError(true), [setIsError])

  if (!src || isError) {
    return (
      <FallbackIcon title={feed?.title ?? ""} size={size} className={cn("rounded", className)} />
    )
  }
  return (
    <Image
      className={cn("rounded", className)}
      style={{ height: size, width: size }}
      source={{ uri: src }}
      onError={handleError}
      {...props}
    />
  )
}
