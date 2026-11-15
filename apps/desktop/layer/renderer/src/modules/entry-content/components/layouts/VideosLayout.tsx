import { useEntry } from "@follow/store/entry/hooks"
import { useState } from "react"

import { EntryTitle } from "../EntryTitle"
import { ContentBody, MediaTranscript, TranscriptToggle, useSubtitles } from "./shared"
import { VideoPlayer } from "./shared/VideoPlayer"
import type { EntryLayoutProps } from "./types"

export const VideosLayout: React.FC<EntryLayoutProps> = ({ entryId, compact = false }) => {
  const entry = useEntry(entryId, (state) => state)
  const { data: subtitles } = useSubtitles(entryId)
  const [showTranscript, setShowTranscript] = useState(false)

  if (!entry) return null

  return (
    <div className="mx-auto flex h-full flex-col p-6">
      {/* Video player area */}
      <VideoPlayer entryId={entryId} className="mb-6" />

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
