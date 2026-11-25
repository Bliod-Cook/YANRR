import type { FeedViewType } from "@follow/constants"
import { useEntry } from "@follow/store/entry/hooks"
import { useFeedById } from "@follow/store/feed/hooks"
import { useIsInbox } from "@follow/store/inbox/hooks"
import { cn } from "@follow/utils"
import { useAtomValue } from "jotai"
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"

import { useEntryIsInReadability } from "~/atoms/readability"
import { useServerCapability } from "~/atoms/server-configs"
import { customCSSPreviewAtom, useUISettingKey } from "~/atoms/settings/ui"
import { ErrorBoundary } from "~/components/common/ErrorBoundary"
import { ShadowDOM } from "~/components/common/ShadowDOM"
import type { TocRef } from "~/components/ui/markdown/components/Toc"
import { useInPeekModal } from "~/components/ui/modal/inspire/InPeekModal"
import { readableContentMaxWidthClassName } from "~/constants/ui"
import { useRenderStyle } from "~/hooks/biz/useRenderStyle"
import { EntryContentHTMLRenderer } from "~/modules/renderer/html"
import { WrappedElementProvider } from "~/providers/wrapped-element-provider"

import { useEntryContent, useEntryMediaInfo } from "../../hooks"
import { ContainerToc } from "../entry-content/accessories/ContainerToc"
import { EntryNoContent } from "../entry-content/EntryNoContent"
import { EntryRenderError } from "../entry-content/EntryRenderError"
import { ReadabilityNotice } from "../entry-content/ReadabilityNotice"
import { EntryAttachments } from "../EntryAttachments"
import { EntryTitle } from "../EntryTitle"
import { MediaTranscript, TranscriptToggle, useSubtitles } from "./shared"
import { ArticleAudioPlayer } from "./shared/AudioPlayer"
import type { EntryLayoutProps } from "./types"

const ArticleAISummary = lazy(() =>
  import("./ArticleAISummary").then((m) => ({ default: m.ArticleAISummary })),
)

export const ArticleLayout: React.FC<EntryLayoutProps> = ({
  entryId,
  view,
  compact = false,
  noMedia = false,
}) => {
  const entry = useEntry(entryId, (state) => ({
    feedId: state.feedId,
    inboxId: state.inboxHandle,
    url: state.url,
  }))
  const { data: subtitles } = useSubtitles(entryId)

  const feed = useFeedById(entry?.feedId)
  const isInbox = useIsInbox(entry?.inboxId)
  const [showTranscript, setShowTranscript] = useState(false)

  const { content } = useEntryContent(entryId)
  const isInReadability = useEntryIsInReadability(entryId)
  const savedCustomCSS = useUISettingKey("customCSS")
  const customCSSPreview = useAtomValue(customCSSPreviewAtom)
  const customCSS = customCSSPreview ?? savedCustomCSS

  const aiEnabled = useServerCapability("ai")

  if (!entry) return null

  return (
    <div className={cn(readableContentMaxWidthClassName, "mx-auto mt-1 px-4")}>
      <EntryTitle entryId={entryId} compact={compact} containerClassName="mt-12 print:mt-6" />

      <ArticleAudioPlayer entryId={entryId} />

      {/* Content Type Toggle */}
      <TranscriptToggle
        showTranscript={showTranscript}
        onToggle={setShowTranscript}
        hasTranscript={!!subtitles}
      />

      <WrappedElementProvider>
        <div className="mx-auto mt-6 mb-32 max-w-full cursor-auto text-[0.94rem]">
          {aiEnabled && (
            <Suspense>
              <ArticleAISummary entryId={entryId} />
            </Suspense>
          )}
          <ErrorBoundary fallback={EntryRenderError}>
            <ReadabilityNotice entryId={entryId} />
            {showTranscript ? (
              <MediaTranscript
                className="prose !max-w-full dark:prose-invert"
                srt={subtitles}
                entryId={entryId}
                type="transcription"
              />
            ) : content || isInReadability ? (
              <ShadowDOM injectHostStyles={!isInbox}>
                {!!customCSS && <style>{customCSS}</style>}

                <ArticleRenderer
                  entryId={entryId}
                  view={view}
                  feedId={feed?.id || ""}
                  noMedia={noMedia}
                  content={content}
                />
              </ShadowDOM>
            ) : (
              <EntryNoContent id={entryId} url={entry.url} view={view} />
            )}
          </ErrorBoundary>
        </div>
      </WrappedElementProvider>

      <EntryAttachments entryId={entryId} />
    </div>
  )
}

/** The content of an article */
export const ArticleRenderer: React.FC<{
  entryId: string
  view: FeedViewType
  feedId: string
  noMedia?: boolean
  content?: Nullable<string>
}> = ({ entryId, view, feedId, noMedia = false, content = "" }) => {
  const mediaInfo = useEntryMediaInfo(entryId)
  const readerRenderInlineStyle = useUISettingKey("readerRenderInlineStyle")
  const stableRenderStyle = useRenderStyle()
  const isInPeekModal = useInPeekModal()

  const tocRef = useRef<TocRef | null>(null)
  const contentAccessories = useMemo(
    () => (isInPeekModal ? undefined : <ContainerToc ref={tocRef} stickyClassName="top-16" />),
    [isInPeekModal],
  )

  useEffect(() => {
    if (tocRef) {
      tocRef.current?.refreshItems()
    }
  }, [content, tocRef])

  return (
    <EntryContentHTMLRenderer
      view={view}
      feedId={feedId}
      entryId={entryId}
      mediaInfo={mediaInfo}
      noMedia={noMedia}
      accessory={contentAccessories}
      as="article"
      className="autospace-normal prose !max-w-full hyphens-auto dark:prose-invert prose-h1:text-[1.6em] prose-h1:font-bold"
      style={stableRenderStyle}
      renderInlineStyle={readerRenderInlineStyle}
    >
      {content}
    </EntryContentHTMLRenderer>
  )
}
