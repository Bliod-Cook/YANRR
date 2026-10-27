import type { ExtractResponseData, SubscriptionImportResponse } from "@follow-app/client-sdk"

import { api } from "../../context"

export type OpmlImportResult = ExtractResponseData<SubscriptionImportResponse>

/** Feeds per import request; the server fetches as many new feeds at once */
const FEEDS_PER_REQUEST = 8
/** A request fetches each new feed for up to 60 s before storing them */
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Imports the feeds at `urls` of an OPML file a few per request, so no request runs for minutes
 * and one that fails costs only its feeds, which count as failed. Imported again, the feeds that
 * made it count as already followed. `onProgress` hears how many feeds are done after each
 * request.
 */
export const importOpmlInBatches = async (
  file: Blob,
  urls: string[],
  onProgress?: (done: number) => void,
): Promise<OpmlImportResult> => {
  const result: OpmlImportResult = { successfulItems: [], conflictItems: [], parsedErrorItems: [] }
  for (let start = 0; start < urls.length; start += FEEDS_PER_REQUEST) {
    const batch = urls.slice(start, start + FEEDS_PER_REQUEST)
    const formData = new FormData()
    formData.append("file", file)
    formData.append("items", JSON.stringify(batch))
    try {
      const { data } = await api().subscriptions.import(formData, { timeout: REQUEST_TIMEOUT_MS })
      result.successfulItems.push(...data.successfulItems)
      result.conflictItems.push(...data.conflictItems)
      result.parsedErrorItems.push(...data.parsedErrorItems)
    } catch (error) {
      console.error("Importing OPML feeds failed:", error)
      result.parsedErrorItems.push(...batch.map((url) => ({ url })))
    }
    onProgress?.(start + batch.length)
  }
  return result
}
