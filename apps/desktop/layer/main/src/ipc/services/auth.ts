import { createAuthRequestOriginHeaders } from "@follow/utils/headers"
import { getApiUrl, normalizeServerUrl } from "@follow/utils/server-url"
import { net } from "electron"
import { IpcMethod, IpcService } from "electron-ipc-decorator"

import { removeSessionCookies } from "../../lib/auth-cookies"
import { getApiURL, getServerUrl, getWebURL } from "../../lib/server-url"
import { store } from "../../lib/store"

const SERVER_ANSWER_TIMEOUT_MS = 10_000

/** Whether a Yanrr server answers at this address */
const answersAsServer = async (server: string) => {
  try {
    const response = await net.fetch(`${getApiUrl(server)}/status/configs`, {
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_ANSWER_TIMEOUT_MS),
    })
    const body = (await response.json()) as { code?: unknown }
    return body.code === 0
  } catch {
    return false
  }
}

// Signing in and up is, like every other request to the API, the page's own business: it
// reaches the server through `lib/api-proxy`.
export class AuthService extends IpcService {
  static override readonly groupName = "auth"

  /**
   * Ends the session on this device, also when the server cannot be told: other than a
   * browser, the app can drop the session cookie itself.
   */
  @IpcMethod()
  async signOut(): Promise<void> {
    await net
      .fetch(`${getApiURL()}/better-auth/sign-out`, {
        method: "POST",
        credentials: "include",
        headers: createAuthRequestOriginHeaders(getWebURL()),
        signal: AbortSignal.timeout(SERVER_ANSWER_TIMEOUT_MS),
      })
      .catch(() => {})
    await removeSessionCookies(getWebURL())
  }

  /** The address the user typed, normalized, once a server answers there like a Yanrr server */
  @IpcMethod()
  async checkServerUrl(
    input: string,
  ): Promise<{ server: string } | { error: "invalid" | "unreachable" }> {
    const server = normalizeServerUrl(input)
    if (!server) return { error: "invalid" }
    if (!(await answersAsServer(server))) return { error: "unreachable" }
    return { server }
  }

  /**
   * Switches to a server `checkServerUrl` answered for, after the renderer cleared the data of the
   * one before. The session with that one ends here; the app relaunches next, as it captures the
   * address at startup.
   */
  @IpcMethod()
  async setServerUrl(server: string): Promise<void> {
    const serverBefore = getServerUrl()
    if (serverBefore) await removeSessionCookies(serverBefore)
    store.set("serverUrl", server)
  }
}
