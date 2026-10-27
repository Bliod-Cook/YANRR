import { useEntry } from "@follow/store/entry/hooks"
import { useQuery } from "@tanstack/react-query"

import { useFeature } from "~/hooks/biz/useFeature"
import { followClient } from "~/lib/api-client"

export const useTranscription = (entryId: string) => {
  const entry = useEntry(entryId, (state) => {
    return {
      audioUrl: state.attachments?.find((att) => att.mime_type?.startsWith("audio/"))?.url,
      subtitleUrl: state.attachments?.find((att) => att.mime_type === "text/srt")?.url,
    }
  })
  // Subtitles the feed attached are read as they are; transcribing audio takes the server's AI.
  const aiEnabled = useFeature("ai")
  const subtitleUrl = entry?.subtitleUrl
  const audioUrl = aiEnabled ? entry?.audioUrl : undefined

  return useQuery({
    queryKey: ["transcription", entryId],
    queryFn: async () => {
      if (subtitleUrl) {
        return (await fetch(subtitleUrl)).text()
      }

      const res = await followClient.api.entries.transcription({ url: audioUrl! })
      return res.data?.srt || ""
    },
    enabled: !!subtitleUrl || !!audioUrl,
  })
}
