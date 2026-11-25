import { IN_ELECTRON } from "@follow/shared/constants"
import { useEntry } from "@follow/store/entry/hooks"
import { transformVideoUrl } from "@follow/utils/url-for-video"
import { cn } from "@follow/utils/utils"
import { useMemo } from "react"

import { VideoPlayer as NativeVideoPlayer } from "~/components/ui/media/VideoPlayer"
import { useImageSrc } from "~/hooks/biz/useImageSrc"
import { getDefaultLanguage } from "~/lib/language"

const ViewTag = IN_ELECTRON ? "webview" : "iframe"

interface VideoPlayerProps {
  entryId: string
  className?: string
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ entryId, className }) => {
  const entry = useEntry(entryId, (state) => ({
    url: state.url,
    attachments: state.attachments,
    video: state.media?.find((media) => media.type === "video"),
  }))

  const poster = useImageSrc(entry?.video?.preview_image_url)
  const lang = getDefaultLanguage()
  const embedSrc = useMemo(
    () =>
      transformVideoUrl({
        url: entry?.url ?? "",
        isIframe: !IN_ELECTRON,
        attachments: entry?.attachments,
        lang,
      }),
    [entry?.attachments, entry?.url, lang],
  )

  if (!entry) return null

  return (
    <div className={cn("aspect-video w-full rounded-md bg-black", className)}>
      {embedSrc ? (
        <ViewTag
          src={embedSrc}
          // A cross-origin iframe may only autoplay with sound or go full screen when allowed;
          // webviews ignore it
          allow="autoplay; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full rounded-md"
        />
      ) : entry.video ? (
        <NativeVideoPlayer
          src={entry.video.url}
          poster={poster.src}
          className="size-full rounded-md object-contain"
        />
      ) : null}
    </div>
  )
}
