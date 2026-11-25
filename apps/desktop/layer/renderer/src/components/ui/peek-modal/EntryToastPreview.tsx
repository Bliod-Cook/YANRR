import { Spring } from "@follow/components/constants/spring.js"
import { useIsEntryStarred } from "@follow/store/collection/hooks"
import { useEntry, usePrefetchEntryDetail } from "@follow/store/entry/hooks"
import { useFeedById } from "@follow/store/feed/hooks"
import { nextFrame, stopPropagation } from "@follow/utils/dom"
import { cn } from "@follow/utils/utils"
import type { Variant } from "motion/react"
import { m, useAnimationControls } from "motion/react"
import { useEffect, useMemo } from "react"

import { RelativeTime } from "~/components/ui/datetime"
import { usePreviewMedia } from "~/components/ui/media/hooks"
import { Media } from "~/components/ui/media/Media"
import { StarIcon } from "~/modules/entry-column/star-icon"
import type { FeedIconEntry } from "~/modules/feed/feed-icon"
import { FeedIcon } from "~/modules/feed/feed-icon"

const variants: Record<string, Variant> = {
  enter: {
    x: 0,
    opacity: 1,
  },
  initial: {
    x: 700,
    opacity: 0.9,
  },
  exit: {
    x: 750,
    opacity: 0,
  },
}

const identity = <T,>(value: T) => value

export const EntryToastPreview = ({ entryId }: { entryId: string }) => {
  usePrefetchEntryDetail(entryId)

  // Select the stored entry itself: a selector that builds a new object re-renders on every store update
  const entry = useEntry(entryId, identity)
  const iconEntry = useMemo<FeedIconEntry>(
    () => ({
      firstPhotoUrl: entry?.media?.find((a) => a.type === "photo")?.url,
      authorAvatar: entry?.authorAvatar,
    }),
    [entry?.media, entry?.authorAvatar],
  )
  const isInCollection = useIsEntryStarred(entryId)

  const feed = useFeedById(entry?.feedId)
  const controller = useAnimationControls()

  const isDisplay = !!entry && !!feed
  useEffect(() => {
    if (isDisplay) {
      nextFrame(() => controller.start("enter"))
    }
  }, [controller, isDisplay])

  const previewMedia = usePreviewMedia()

  if (!isDisplay) return null

  return (
    <m.div
      tabIndex={-1}
      initial="initial"
      animate={controller}
      onPointerDown={stopPropagation}
      onPointerDownCapture={stopPropagation}
      variants={variants}
      onWheel={stopPropagation}
      transition={Spring.presets.snappy}
      exit="exit"
      layout="size"
      className={cn(
        "relative flex flex-col items-center rounded-xl border bg-theme-background p-8 shadow-perfect",
        "mt-4 mr-4 max-h-[500px] w-[60ch] max-w-full overflow-auto",
      )}
    >
      <div className="flex w-full gap-3">
        <FeedIcon
          fallback
          className="mask-squircle mask"
          target={feed}
          entry={iconEntry}
          size={36}
        />
        <div className="flex min-w-0 grow flex-col">
          <div className="w-[calc(100%-10rem)] space-x-1">
            <span className="font-semibold">{entry.author}</span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-500">
              <RelativeTime date={entry.publishedAt} />
            </span>
          </div>
          <div
            className={cn(
              "relative mt-0.5 text-base whitespace-pre-line",
              isInCollection && "pr-5",
            )}
          >
            <div
              className={cn(
                "rounded-xl p-3 align-middle text-[15px]",
                "rounded-tl-none bg-zinc-600/5 dark:bg-zinc-500/20",
                "mt-1 -translate-x-3",
                "break-words",
              )}
            >
              {entry.description}

              {!!entry.media?.length && (
                <div className="mt-1 flex w-full gap-2 overflow-x-auto">
                  {entry.media.map((media, i, mediaList) => (
                    <Media
                      key={media.url}
                      src={media.url}
                      type={media.type}
                      previewImageUrl={media.preview_image_url}
                      className="size-28 shrink-0 cursor-zoom-in"
                      loading="lazy"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        previewMedia(mediaList, i)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            {isInCollection && <StarIcon />}
          </div>

          {/* End right column */}
        </div>
      </div>
    </m.div>
  )
}
