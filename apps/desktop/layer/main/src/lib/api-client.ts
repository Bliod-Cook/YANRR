import { FollowClient } from "@follow-app/client-sdk"
import { net } from "electron"

import { logger } from "../logger"
import { getApiURL } from "./server-url"

const createApiClient = () => {
  const followClient = new FollowClient({
    timeout: 10000,
    baseURL: getApiURL(),
    // Chromium's network stack: the app's proxy settings apply, and the session cookie goes
    // along from its cookie store
    fetch: async (input, options = {}) =>
      net.fetch(input.toString(), {
        ...options,
        credentials: "include",
        cache: "no-store",
      }),
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
