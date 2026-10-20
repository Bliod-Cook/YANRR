import { Logo } from "@follow/components/icons/logo.jsx"
import { Wordmark } from "@follow/components/icons/wordmark.jsx"
import { useEntry } from "@follow/store/entry/hooks"
import { useFeedById } from "@follow/store/feed/hooks"
import { useInboxById } from "@follow/store/inbox/hooks"
import { cn } from "@follow/utils/utils"
import { useTranslation } from "react-i18next"

import { readableContentMaxWidthClassName } from "~/constants/ui"

export const EntryPrintHeader = ({ entryId }: { entryId: string }) => {
  const { t } = useTranslation()
  const entry = useEntry(entryId, (state) => ({
    feedId: state.feedId,
    inboxId: state.inboxHandle,
  }))

  const feed = useFeedById(entry?.feedId)
  const inbox = useInboxById(entry?.inboxId)
  const sourceTitle = feed?.title || inbox?.title

  return (
    <div className={cn("hidden print:block", readableContentMaxWidthClassName, "mx-auto px-4")}>
      <div className="mb-8 border-b border-border pb-4">
        <div className="flex items-center gap-1.5">
          <Logo className="size-4 shrink-0" />
          <Wordmark className="text-sm text-text" />
        </div>

        {sourceTitle ? (
          <p className="mt-3 text-sm text-text-secondary">
            {t("entry_content.print.source", {
              source: sourceTitle,
            })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
