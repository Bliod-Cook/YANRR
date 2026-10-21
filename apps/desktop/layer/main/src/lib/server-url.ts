import { getApiUrl, normalizeServerUrl } from "@follow/utils/server-url"

import { store } from "./store"

/**
 * The server the app talks to, which the user enters before signing in. `YANRR_SERVER_URL`
 * overrides it for development and E2E runs.
 */
export const getServerUrl = (): string | null =>
  normalizeServerUrl(process.env.YANRR_SERVER_URL ?? "") ?? store.get("serverUrl") ?? null

const requireServerUrl = () => {
  const server = getServerUrl()
  if (!server) throw new Error("No server address is set")
  return server
}

export const getApiURL = () => getApiUrl(requireServerUrl())

/** The server also hosts the web app */
export const getWebURL = requireServerUrl
