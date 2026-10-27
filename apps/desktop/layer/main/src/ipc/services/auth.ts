import {
  buildBetterAuthSessionTokenCookieHeader,
  getBetterAuthSessionTokenCookieName,
} from "@follow/shared/auth-cookie"
import { createAuthRequestOriginHeaders, createDesktopAPIHeaders } from "@follow/utils/headers"
import { getApiUrl, normalizeServerUrl } from "@follow/utils/server-url"
import PKG from "@pkg"
import { net } from "electron"
import { IpcMethod, IpcService } from "electron-ipc-decorator"

import { BETTER_AUTH_COOKIE_NAME_SESSION_TOKEN } from "~/constants/app"
import { WindowManager } from "~/manager/window"

import {
  buildManagedAuthCookieHeader,
  dedupeManagedAuthCookies,
  getManagedAuthCookies,
  persistManagedAuthCookiesFromSetCookieHeader,
  removeManagedAuthCookies,
} from "../../lib/auth-cookies"
import { getApiURL, getServerUrl, getWebURL } from "../../lib/server-url"
import { store } from "../../lib/store"
import { deleteNotificationsToken, updateNotificationsToken } from "../../lib/user"

/** Whether a Yanrr server answers at this address */
const answersAsServer = async (server: string) => {
  try {
    const response = await net.fetch(`${getApiUrl(server)}/status/configs`, {
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json()) as { code?: unknown }
    return body.code === 0
  } catch {
    return false
  }
}

/**
 * How long a renderer request may take at most, longer than any it times out itself: OPML imports
 * and the AI-sorted timeline wait up to 3 minutes.
 */
const FETCH_DEADLINE_MS = 240_000

export class AuthService extends IpcService {
  static override readonly groupName = "auth"

  /** Requests of `fetchWithAuth` that have not finished, by the id the renderer gave them */
  private readonly requestsInFlight = new Map<string, AbortController>()

  private async getManagedCookieHeader(): Promise<string> {
    const mainWindow = WindowManager.getMainWindow()
    if (!mainWindow) {
      return ""
    }

    return buildManagedAuthCookieHeader(
      await getManagedAuthCookies({
        apiURL: getApiURL(),
        session: mainWindow.webContents.session,
      }),
    )
  }

  private async persistAuthCookiesFromResponse(response: Response): Promise<void> {
    const setCookieValues =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []
    const setCookie =
      setCookieValues.length > 0
        ? setCookieValues.join(", ")
        : response.headers.get("set-cookie") || ""
    const mainWindow = WindowManager.getMainWindow()
    if (response.ok && setCookie && mainWindow) {
      await persistManagedAuthCookiesFromSetCookieHeader({
        apiURL: getApiURL(),
        session: mainWindow.webContents.session,
        setCookieHeader: setCookie,
      })
    }
  }

  private getAuthRequestHeaders(additionalHeaders?: Record<string, string>) {
    return {
      ...createDesktopAPIHeaders({ version: PKG.version }),
      ...createAuthRequestOriginHeaders(getWebURL()),
      ...additionalHeaders,
    }
  }

  private async applySessionToken(token: string): Promise<void> {
    const mainWindow = WindowManager.getMainWindow()
    if (!mainWindow || !token) {
      return
    }

    const apiURL = getApiURL()
    const url = new URL(apiURL)
    const isSecure =
      url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1"
    const cookieName = getBetterAuthSessionTokenCookieName(apiURL)
    const cookieSession = mainWindow.webContents.session

    await removeManagedAuthCookies({
      apiURL,
      session: cookieSession,
      names: [BETTER_AUTH_COOKIE_NAME_SESSION_TOKEN, "__Secure-better-auth.session_token"],
    })
    await cookieSession.cookies.set({
      url: apiURL,
      name: cookieName,
      value: token,
      path: "/",
      httpOnly: true,
      secure: isSecure,
      sameSite: "no_restriction",
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    })
    await dedupeManagedAuthCookies({ apiURL, session: cookieSession })
  }

  private async clearSessionToken(): Promise<void> {
    const mainWindow = WindowManager.getMainWindow()
    if (!mainWindow) {
      return
    }

    const { session } = mainWindow.webContents
    const apiURL = getApiURL()
    await removeManagedAuthCookies({ apiURL, session })
  }

  private async requestCredentialAuth(
    path: "/sign-in/email" | "/sign-up/email",
    payload: Record<string, unknown>,
  ) {
    const response = await net.fetch(`${getApiURL()}/better-auth${path}`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        ...this.getAuthRequestHeaders(),
      },
      body: JSON.stringify(payload),
    })

    const data = (await response
      .json()
      .catch(async () => ({ message: await response.text() }))) as Record<string, unknown>

    const setCookieValues =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []
    const setCookie =
      setCookieValues.length > 0
        ? setCookieValues.join(", ")
        : response.headers.get("set-cookie") || ""
    const mainWindow = WindowManager.getMainWindow()
    await this.persistAuthCookiesFromResponse(response)

    const sessionCookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/)
    const sessionToken = sessionCookieMatch?.[1] ?? null
    const token = typeof data.token === "string" ? data.token : null
    const persistedSessionToken = sessionToken ?? token
    if (response.ok && persistedSessionToken && !setCookie && mainWindow) {
      await this.applySessionToken(persistedSessionToken)
    }

    if (sessionToken) {
      data.sessionToken = sessionToken
    }

    return {
      data,
      error: response.ok
        ? null
        : {
            message: typeof data.message === "string" ? data.message : response.statusText,
            status: response.status,
          },
    }
  }

  /**
   * Every API request of the renderer travels through here. It goes out with `net.fetch`,
   * Chromium's network stack, so it follows the same proxy settings as the rest of the app,
   * including the system proxy, PAC files and SOCKS. Node's `fetch` would ignore all of
   * those. Cookies are attached by hand from the managed auth cookies, so Chromium's own
   * cookie handling is switched off for these requests.
   */
  @IpcMethod()
  async fetchWithAuth(payload: {
    body?: string
    headers?: Record<string, string>
    method: string
    url: string
    /** Names the request for `cancelFetch` */
    requestId: string
  }) {
    const requestURL = new URL(payload.url)
    const apiURL = new URL(getApiURL())
    if (requestURL.origin !== apiURL.origin) {
      throw new Error("Refusing to proxy non-API request")
    }

    const headers = new Headers(payload.headers)
    headers.delete("content-length")
    headers.delete("host")
    for (const [key, value] of Object.entries(this.getAuthRequestHeaders())) {
      headers.set(key, value)
    }

    if (!headers.has("cookie")) {
      const cookieHeader = await this.getManagedCookieHeader()
      if (cookieHeader) {
        headers.set("Cookie", cookieHeader)
      }
    }

    const controller = new AbortController()
    this.requestsInFlight.set(payload.requestId, controller)
    // A renderer that reloaded or crashed never cancels what it started.
    const deadline = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS)
    try {
      const response = await net.fetch(payload.url, {
        method: payload.method,
        credentials: "omit",
        headers,
        body:
          payload.body !== undefined && payload.method !== "GET" && payload.method !== "HEAD"
            ? payload.body
            : undefined,
        signal: controller.signal,
      })

      await this.persistAuthCookiesFromResponse(response)

      return {
        body: await response.text(),
        headers: Array.from(response.headers.entries()),
        status: response.status,
        statusText: response.statusText,
      }
    } finally {
      clearTimeout(deadline)
      this.requestsInFlight.delete(payload.requestId)
    }
  }

  /**
   * Stops a request of `fetchWithAuth` that the renderer timed out or gave up on. Left running, it
   * would hold one of the few connections Chromium opens to the server.
   */
  @IpcMethod()
  cancelFetch(requestId: string): void {
    this.requestsInFlight.get(requestId)?.abort()
  }

  @IpcMethod()
  async sessionChanged(): Promise<void> {
    await updateNotificationsToken()
  }

  @IpcMethod()
  async signOut(): Promise<void> {
    await deleteNotificationsToken()
  }

  @IpcMethod()
  async signOutRemote(token?: string): Promise<void> {
    const apiURL = getApiURL()
    await net
      .fetch(`${apiURL}/better-auth/sign-out`, {
        method: "POST",
        credentials: "omit",
        headers: this.getAuthRequestHeaders(
          token
            ? {
                Cookie: buildBetterAuthSessionTokenCookieHeader(apiURL, token),
              }
            : undefined,
        ),
      })
      .catch(() => {})

    await this.clearSessionToken()
  }

  /**
   * Switches to the server at the address the user typed, once it answers like one. The session
   * with the server before ends here; the renderer clears its own data and relaunches the app,
   * which captures the address at startup.
   */
  @IpcMethod()
  async setServerUrl(input: string): Promise<"invalid" | "unreachable" | null> {
    const server = normalizeServerUrl(input)
    if (!server) return "invalid"
    if (!(await answersAsServer(server))) return "unreachable"

    if (getServerUrl()) await this.clearSessionToken()
    store.set("serverUrl", server)
    return null
  }

  @IpcMethod()
  async signInWithCredential(payload: { email: string; password: string }) {
    return this.requestCredentialAuth("/sign-in/email", {
      email: payload.email,
      password: payload.password,
    })
  }

  @IpcMethod()
  async signUpWithCredential(payload: { email: string; password: string; name: string }) {
    return this.requestCredentialAuth("/sign-up/email", {
      email: payload.email,
      password: payload.password,
      name: payload.name,
    })
  }

  @IpcMethod()
  async setSessionToken(token: string): Promise<void> {
    await this.applySessionToken(token)
  }
}
