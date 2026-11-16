import { useEntry } from "@follow/store/entry/hooks"
import { useFeedById } from "@follow/store/feed/hooks"
import { cn } from "@follow/utils/utils"

import { usePreviewMedia } from "~/components/ui/media/hooks"
import { Media } from "~/components/ui/media/Media"
import { toPreviewMedia } from "~/components/ui/media/PreviewMediaContent"
import { readableContentMaxWidthClassName } from "~/constants/ui"

import { AuthorHeader } from "./shared/AuthorHeader"
import { ContentBody } from "./shared/ContentBody"
import type { EntryLayoutProps } from "./types"

export const SocialMediaLayout: React.FC<EntryLayoutProps> = ({
  entryId,
  compact = false,
  noMedia = false,
}) => {
  const entry = useEntry(entryId, (state) => ({ feedId: state.feedId, media: state.media }))
  const feed = useFeedById(entry?.feedId)
  const previewMedia = usePreviewMedia()

  if (!entry || !feed) return null

  const media = (!noMedia && entry.media) || []

  return (
    <div className={cn(readableContentMaxWidthClassName, "mx-auto space-y-5 pt-12 print:pt-6")}>
      {/* Single Author header without avatar */}
      <AuthorHeader entryId={entryId} />

      {/* Main content - direct ContentBody usage without show more logic */}
      <ContentBody
        entryId={entryId}
        compact={compact}
        className="text-base leading-relaxed"
        noMedia={true}
      />

      {/* Media gallery */}
      {media.map((m, i) => (
        <div key={m.url} className="mt-4 flex justify-center">
          <Media
            src={m.url}
            type={m.type}
            previewImageUrl={m.preview_image_url}
            blurhash={m.blurhash}
            className="cursor-zoom-in"
            onClick={() => previewMedia(toPreviewMedia(media), i)}
          />
        </div>
      ))}
    </div>
  )
}
