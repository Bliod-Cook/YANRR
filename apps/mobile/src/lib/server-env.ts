import type { JotaiSyncStorage } from "@follow/utils"
import { createAtomHooks } from "@follow/utils"
import { getApiUrl, normalizeServerUrl } from "@follow/utils/server-url"
import { atomWithStorage } from "jotai/utils"

import { JotaiPersistSyncStorage } from "./jotai"

const [, , useStoredServerUrl, , getStoredServerUrl, setStoredServerUrl] = createAtomHooks(
  atomWithStorage<string | null>(
    "##Yannr-Server-Url",
    null,
    JotaiPersistSyncStorage as JotaiSyncStorage<string | null>,
    { getOnInit: true },
  ),
)

// Builds for development and E2E can come with their server
const serverUrlOverride = normalizeServerUrl(process.env.EXPO_PUBLIC_YANNR_SERVER_URL ?? "")

/** The server the app talks to, which the user enters on the login screen; null until then */
export const getServerUrl = () => serverUrlOverride ?? getStoredServerUrl()

export const useServerUrl = () => {
  const storedServerUrl = useStoredServerUrl()
  return serverUrlOverride ?? storedServerUrl
}

/** Takes effect once the app reloads: the clients keep the address they started with */
export const saveServerUrl = (server: string) => setStoredServerUrl(server)

/** The server's addresses, empty until the user has set a server */
export const serverEnv = {
  get API_URL() {
    const server = getServerUrl()
    return server ? getApiUrl(server) : ""
  },
  /** The server also hosts the web app */
  get WEB_URL() {
    return getServerUrl() ?? ""
  },
}

/** Whether a Yannr server answers at this address */
export const answersAsServer = async (server: string) => {
  try {
    const response = await fetch(`${getApiUrl(server)}/status/configs`, {
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json()) as { code?: unknown }
    return body.code === 0
  } catch {
    return false
  }
}
