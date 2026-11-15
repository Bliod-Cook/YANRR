import { IN_ELECTRON } from "@follow/shared/constants"
import { useEntry } from "@follow/store/entry/hooks"
import { transformVideoUrl } from "@follow/utils/url-for-video"
import { cn } from "@follow/utils/utils"
import { useMemo } from "react"

import { Media } from "~/components/ui/media/Media"
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
    firstMedia: state.media?.[0],
  }))

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
    <div className={cn("aspect-video w-full", className)}>
      {embedSrc ? (
        <ViewTag
          src={embedSrc}
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full rounded-md bg-black"
        />
      ) : entry.firstMedia ? (
        <Media
          key={entry.firstMedia.url}
          src={entry.firstMedia.url}
          type={entry.firstMedia.type}
          previewImageUrl={entry.firstMedia.preview_image_url}
          className="size-full rounded-md object-cover"
          videoClassName="object-contain"
          loading="lazy"
          showFallback={true}
        />
      ) : null}
    </div>
  )
}
