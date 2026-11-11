import { useEntry } from "@follow/store/entry/hooks"
import { useFeedById } from "@follow/store/feed/hooks"
import { useTranslation } from "react-i18next"

import { EntryContentLoading } from "./EntryContentLoading"

/** Stands in for the content of an entry while it loads, or says why it failed to load */
export const EntryContentPlaceholder = ({
  entryId,
  error,
}: {
  entryId: string
  error: Error | null
}) => {
  const { t } = useTranslation()
  const feedId = useEntry(entryId, (state) => state.feedId)
  const siteUrl = useFeedById(feedId, (feed) => feed.siteUrl)

  return (
    <div className="center mt-16 min-w-0">
      {error ? (
        <div className="center mt-36 flex flex-col items-center gap-3">
          <i className="i-mgc-warning-cute-re text-4xl text-red" />
          <span className="text-balance text-center text-sm">
            {t("entry_content.network_error")}
          </span>
          <pre className="mt-6 w-full overflow-auto whitespace-pre-wrap break-all">
            {error.message}
          </pre>
        </div>
      ) : (
        <EntryContentLoading icon={siteUrl} />
      )}
    </div>
  )
}
