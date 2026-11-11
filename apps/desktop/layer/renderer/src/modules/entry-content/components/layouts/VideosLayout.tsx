import { useEntry } from "@follow/store/entry/hooks"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { EntryTitle } from "../EntryTitle"
import { ContentBody, MediaTranscript, TranscriptToggle, useSubtitles } from "./shared"
import { VideoPlayer } from "./shared/VideoPlayer"
import type { EntryLayoutProps } from "./types"

export const VideosLayout: React.FC<EntryLayoutProps> = ({
  entryId,
  compact = false,
  noMedia = false,
}) => {
  const { t } = useTranslation()
  const entry = useEntry(entryId, (state) => state)
  const { data: subtitles } = useSubtitles(entryId)
  const [showTranscript, setShowTranscript] = useState(false)

  if (!entry) return null

  return (
    <div className="mx-auto flex h-full flex-col p-6">
      {/* Video player area */}
      <div className="mb-6 w-full">
        {!noMedia ? (
          <VideoPlayer
            entryId={entryId}
            showDuration={true}
            preferFullSize={true}
            className="w-full"
          />
        ) : (
          <div className="center aspect-video w-full flex-col gap-1 rounded-md bg-material-medium text-sm text-text-secondary">
            <i className="i-mgc-video-cute-fi mb-2 size-12" />
            {t("entry_content.video_unavailable")}
          </div>
        )}
      </div>

      {/* Content area below video */}
      <div className="flex-1 space-y-4">
        {/* Title */}
        <EntryTitle entryId={entryId} compact={compact} />

        {/* Content Type Toggle */}
        <TranscriptToggle
          showTranscript={showTranscript}
          onToggle={setShowTranscript}
          hasTranscript={!!subtitles}
        />

        {/* Description/Content or Transcript */}
        {showTranscript ? (
          <MediaTranscript
            className="prose !max-w-full dark:prose-invert"
            srt={subtitles}
            entryId={entryId}
            type="subtitle"
          />
        ) : (
          <ContentBody entryId={entryId} compact={compact} noMedia={true} className="text-base" />
        )}
      </div>
    </div>
  )
}
