import { useEntry } from "@follow/store/entry/hooks"
import { getFeedById } from "@follow/store/feed/getter"
import { resolveContentUrl } from "@follow/utils/content-url"
import { use, useCallback, useMemo } from "react"

import { MarkdownRenderActionContext } from "~/components/ui/markdown/context"

/** Makes an address in the entry's content absolute against the entry's page, else its feed's site */
export const useEntryContentUrlTransform = (entryId: string) => {
  const entry = useEntry(entryId, (state) => ({ url: state.url, feedId: state.feedId }))
  const entryUrl = entry?.url
  const feedId = entry?.feedId
  return useCallback(
    (url?: string) => url && resolveContentUrl(url, entryUrl || getFeedById(feedId)?.siteUrl),
    [entryUrl, feedId],
  )
}

/** For entry content rendered by a plain `HTML`, outside the entry renderer */
export const EntryContentUrlProvider: Component<{ entryId: string }> = ({ entryId, children }) => {
  const actions = use(MarkdownRenderActionContext)
  const transformUrl = useEntryContentUrlTransform(entryId)
  const value = useMemo(() => ({ ...actions, transformUrl }), [actions, transformUrl])
  return <MarkdownRenderActionContext value={value}>{children}</MarkdownRenderActionContext>
}
