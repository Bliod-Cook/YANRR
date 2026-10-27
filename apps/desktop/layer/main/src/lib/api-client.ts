import { createDesktopAPIHeaders } from "@follow/utils/headers"
import { FollowClient } from "@follow-app/client-sdk"
import PKG, { version as appVersion } from "@pkg"
import { net } from "electron"

import { WindowManager } from "~/manager/window"

import { logger } from "../logger"
import { getPreferredSessionTokenCookie } from "./auth-cookies"
import { getApiURL } from "./server-url"

const createApiClient = () => {
  const apiURL = getApiURL()
  const followClient = new FollowClient({
    credentials: "include",
    timeout: 10000,

    baseURL: apiURL,
    // Chromium's network stack, so the app's proxy settings apply. The session cookie is put
    // on the request by the interceptor below; Chromium's own cookie handling stays off.
    fetch: async (input, options = {}) =>
      net.fetch(input.toString(), {
        ...options,
        credentials: "omit",
        cache: "no-store",
      }),
  })

  followClient.addRequestInterceptor(async (ctx) => {
    const { options } = ctx
    const header = options.headers || {}

    const apiHeader = createDesktopAPIHeaders({ version: PKG.version })

    // Get cookies for authentication
    const window = WindowManager.getMainWindow()
    const cookies = await window?.webContents.session.cookies.get({
      domain: new URL(apiURL).hostname,
    })
    const sessionCookie = cookies ? getPreferredSessionTokenCookie(cookies) : null
    const headerCookie = sessionCookie ? `${sessionCookie.name}=${sessionCookie.value}` : ""
    const userAgent = window?.webContents.getUserAgent() || `Yanrr/${PKG.version}`

    options.headers = {
      ...header,
      ...apiHeader,
      Cookie: headerCookie,
      "User-Agent": userAgent,

      "X-Follow-App-Version": appVersion,
      "X-Follow-Platform": process.platform,
    }
    return ctx
  })
  followClient.addResponseInterceptor(({ response }) => {
    logger.info(`API Response: ${response.status} ${response.statusText}`)
    return response
  })

  followClient.addErrorInterceptor(async ({ response, error }) => {
    if (!response) {
      logger.error("API Request failed - no response", error)
      return error
    }
  })

  followClient.addResponseInterceptor(async ({ response }) => {
    // Handle specific error cases if needed in main process
    if (response.status === 401) {
      logger.warn("Authentication failed in main process")
    }

    return response
  })

  return followClient.api
}

let apiClient: ReturnType<typeof createApiClient> | undefined

/** Created on first use: until the user sets a server, there is none to talk to */
export const getApiClient = () => (apiClient ??= createApiClient())
