import type { FeedViewType } from "@follow/constants"
import { useEntry } from "@follow/store/entry/hooks"
import { useEffect } from "react"

import { enableShowSourceContent } from "~/atoms/source-content"
import { enableEntryReadability, isArticleLayoutView } from "~/hooks/biz/useEntryActions"

/** Applies the rule actions of the entry that open its source page or its readable content */
export const ApplyEntryActions = ({ entryId, view }: { entryId: string; view: FeedViewType }) => {
  const entry = useEntry(entryId, (s) => {
    if (!s.settings) return null
    return {
      readability: s.settings.readability,
      sourceContent: s.settings.sourceContent,
      url: s.url,
    }
  })

  return (
    <>
      {entry?.sourceContent && <ViewSourceContentAutoToggleEffect id={entryId} />}
      {entry?.readability && isArticleLayoutView(view) && (
        <ReadabilityAutoToggleEffect id={entryId} url={entry?.url ?? ""} />
      )}
    </>
  )
}

const ViewSourceContentAutoToggleEffect = ({ id }: { id: string }) => {
  useEffect(() => {
    enableShowSourceContent()
  }, [id])
  return null
}

export const ReadabilityAutoToggleEffect = ({ url, id }: { url: string; id: string }) => {
  useEffect(() => {
    enableEntryReadability({ id, url })
  }, [id, url])

  return null
}
