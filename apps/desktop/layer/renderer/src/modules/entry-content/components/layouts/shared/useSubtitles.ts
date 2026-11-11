import { useEntry } from "@follow/store/entry/hooks"
import { useQuery } from "@tanstack/react-query"

/** The SRT subtitles the feed attached to the entry */
export const useSubtitles = (entryId: string) => {
  const subtitleUrl = useEntry(
    entryId,
    (state) => state.attachments?.find((attachment) => attachment.mime_type === "text/srt")?.url,
  )

  return useQuery({
    queryKey: ["subtitles", subtitleUrl],
    queryFn: async () => {
      const response = await fetch(subtitleUrl!)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.text()
    },
    enabled: !!subtitleUrl,
  })
}
