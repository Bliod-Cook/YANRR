import { IN_ELECTRON } from "@follow/shared/constants"
import type { FetchTemplate } from "@follow/shared/settings/interface"
import { t } from "i18next"

import { getIntegrationSettings } from "~/atoms/settings/integration"
import { ipcServices } from "~/lib/client"

export interface IntegrationRequest {
  method: FetchTemplate["method"]
  headers: Record<string, string>
  body?: string
}

export interface IntegrationResponse {
  ok: boolean
  status: number
  statusText: string
}

const BROWSER_TIMEOUT_MS = 30_000

/**
 * Sends a custom integration's request. The desktop app sends it from the main process, where
 * the page's CORS rules do not apply, unless the user chose the browser's fetch.
 */
export const sendIntegrationRequest = async (
  url: string,
  request: IntegrationRequest,
): Promise<IntegrationResponse> => {
  if (IN_ELECTRON && !getIntegrationSettings().useBrowserFetch) {
    return ipcServices!.integration.customFetch({ url, ...request })
  }

  try {
    const { ok, status, statusText } = await fetch(url, {
      ...request,
      signal: AbortSignal.timeout(BROWSER_TIMEOUT_MS),
    })
    return { ok, status, statusText }
  } catch {
    // Not the browser's message: in some browsers it names the URL, and a URL can hold a token
    throw new Error(t("entry_actions.custom_integration.network_error"))
  }
}
