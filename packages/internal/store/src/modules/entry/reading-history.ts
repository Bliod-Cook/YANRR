import { useEffect } from "react"

import { api } from "../../context"

/** How long an entry stays open before it counts as read rather than skimmed past */
export const ENTRY_OPENED_AFTER_MS = 3000

/**
 * Notes in the server's reading history, which agents list over MCP, that the user opened the
 * entry and kept it open for a moment. A failure is dropped: the history is a convenience.
 */
export const useRecordEntryOpened = (entryId: string | undefined, enabled: boolean) => {
  useEffect(() => {
    if (!entryId || !enabled) return
    const timer = setTimeout(() => {
      api()
        .readingHistory.opened({ entryId })
        .catch(() => {})
    }, ENTRY_OPENED_AFTER_MS)
    return () => clearTimeout(timer)
  }, [entryId, enabled])
}
