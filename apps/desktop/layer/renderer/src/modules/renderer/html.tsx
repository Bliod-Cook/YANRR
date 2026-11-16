import { FeedViewType } from "@follow/constants"
import { useEntry } from "@follow/store/entry/hooks"
import { timeStringToSeconds } from "@follow/utils/utils"
import { useMemo } from "react"
import type { JSX } from "react/jsx-runtime"

import { useSpotlightSettingKey } from "~/atoms/settings/spotlight"
import {
  MarkdownImageRecordContext,
  MarkdownRenderActionContext,
} from "~/components/ui/markdown/context"
import type { HTMLProps } from "~/components/ui/markdown/HTML"
import { HTML } from "~/components/ui/markdown/HTML"
import type { MarkdownImage, MarkdownRenderActions } from "~/components/ui/markdown/types"

import { TimeStamp } from "./components/TimeStamp"
import { useEntryContentUrlTransform } from "./content-url"
import { EntryInfoContext } from "./context"
import type { EntryContentRendererProps } from "./types"

export function EntryContentHTMLRenderer<AS extends keyof JSX.IntrinsicElements = "div">({
  view,
  feedId,
  entryId,
  children,
  ...props
}: EntryContentRendererProps & HTMLProps<AS>) {
  const spotlightRules = useSpotlightSettingKey("spotlights")
  // Select the media array itself, which keeps its reference, and build the image record from it,
  // or the record is new on every store update and re-renders the whole article
  const entry = useEntry(entryId, (state) => ({
    media: state.media,
    url: state.url,
  }))
  const media = entry?.media
  const images: Record<string, MarkdownImage> = useMemo(
    () =>
      media?.reduce(
        (acc, item) => {
          if (item.height && item.width) {
            acc[item.url] = item
          }
          return acc
        },
        {} as Record<string, MarkdownImage>,
      ) ?? {},
    [media],
  )
  const coverImageUrl = media?.[0]?.type === "photo" ? media[0].url : undefined
  const transformUrl = useEntryContentUrlTransform(entryId)
  const actions: MarkdownRenderActions = useMemo(() => {
    return {
      isAudio() {
        return view === FeedViewType.Audios
      },
      transformUrl,
      ensureAndRenderTimeStamp,
    }
  }, [transformUrl, view])
  return (
    <MarkdownImageRecordContext.Provider value={images}>
      <MarkdownRenderActionContext value={actions}>
        <EntryInfoContext value={useMemo(() => ({ feedId, entryId }), [feedId, entryId])}>
          {/*  @ts-expect-error */}
          <HTML
            {...props}
            spotlightRules={spotlightRules}
            coverImageUrl={coverImageUrl}
            baseUrl={entry?.url ?? undefined}
          >
            {children}
          </HTML>
        </EntryInfoContext>
      </MarkdownRenderActionContext>
    </MarkdownImageRecordContext.Provider>
  )
}

const ensureAndRenderTimeStamp = (children: string) => {
  const firstPart = children.replace(" ", " ").split(" ")[0]
  // 00:00 , 00:00:00
  if (!firstPart) {
    return
  }
  if (timeStringToSeconds(firstPart.trim()) !== null) {
    return (
      <>
        <TimeStamp time={firstPart} />
        <span>{children.slice(firstPart.length)}</span>
      </>
    )
  }
  return false
}
