import type {
  ExtractResponseData,
  FollowClient,
  SubscriptionImportResponse,
} from "@follow-app/client-sdk"

import type { SubscriptionImportRequest } from "../../api-contract"

export type OpmlImportResult = ExtractResponseData<SubscriptionImportResponse>

export type OpmlImportItem = SubscriptionImportRequest["items"][number]

/** Feeds per import request; the server fetches as many new feeds at once */
const FEEDS_PER_REQUEST = 8
/** A request fetches each new feed for up to 60 s before storing them */
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Imports `items` of a parsed OPML file a few per request, so no request runs for minutes.
 * `onProgress` hears how many feeds are done after each request. A request that fails as a whole
 * (network, sign-in) rejects and no later request is sent; feeds the server could not import
 * come back in `parsedErrorItems`.
 */
export const importOpmlInBatches = async (
  client: Pick<FollowClient, "request">,
  items: OpmlImportItem[],
  onProgress?: (done: number) => void,
): Promise<OpmlImportResult> => {
  const result: OpmlImportResult = { successfulItems: [], conflictItems: [], parsedErrorItems: [] }
  for (let start = 0; start < items.length; start += FEEDS_PER_REQUEST) {
    const batch = items.slice(start, start + FEEDS_PER_REQUEST)
    const { data } = await client.request<SubscriptionImportResponse>("/subscriptions/import", {
      method: "POST",
      body: { items: batch } satisfies SubscriptionImportRequest,
      timeout: REQUEST_TIMEOUT_MS,
    })
    result.successfulItems.push(...data.successfulItems)
    result.conflictItems.push(...data.conflictItems)
    result.parsedErrorItems.push(...data.parsedErrorItems)
    onProgress?.(start + batch.length)
  }
  return result
}
