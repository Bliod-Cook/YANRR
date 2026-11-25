import type { FeedViewType } from "@follow/constants"
import type { FC } from "react"
import { useTranslation } from "react-i18next"

import { useShowSourceContent } from "~/atoms/source-content"
import { isArticleLayoutView } from "~/hooks/biz/useEntryActions"

import { ReadabilityAutoToggleEffect } from "../ApplyEntryActions"

/** In place of the missing content of an entry: its readable web page, where the view shows that */
export const EntryNoContent: FC<{
  id: string
  url: string | null | undefined
  view: FeedViewType
}> = ({ id, url, view }) => {
  const showSourceContent = useShowSourceContent()
  const { t } = useTranslation("app")

  if (url && !showSourceContent && isArticleLayoutView(view)) {
    return <ReadabilityAutoToggleEffect url={url} id={id} />
  }
  return (
    <div className="mt-16 center text-center text-sm text-balance text-zinc-400">
      {t("entry_content.no_content")}
    </div>
  )
}
