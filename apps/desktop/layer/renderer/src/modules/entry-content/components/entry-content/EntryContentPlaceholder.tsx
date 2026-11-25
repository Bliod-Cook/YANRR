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
    <div className="mt-16 center min-w-0">
      {error ? (
        <div className="mt-36 center flex flex-col items-center gap-3">
          <i className="i-mgc-warning-cute-re text-4xl text-red" />
          <span className="text-center text-sm text-balance">
            {t("entry_content.network_error")}
          </span>
          <pre className="mt-6 w-full overflow-auto break-all whitespace-pre-wrap">
            {error.message}
          </pre>
        </div>
      ) : (
        <EntryContentLoading icon={siteUrl} />
      )}
    </div>
  )
}
