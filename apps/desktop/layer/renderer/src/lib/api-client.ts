import { env } from "@follow/shared/env.desktop"
import { followAPIOf } from "@follow/store/api-contract"
import { whoami } from "@follow/store/user/getters"
import { fetchSessionUser } from "@follow/store/user/hooks"
import { trackApiConnection } from "@follow/utils/api-connection"
import { FollowClient } from "@follow-app/client-sdk"

import { setApiUnreachable } from "~/atoms/api-connection"

// The API is on the page's own origin: the server's in a browser, and in the desktop app the
// main process answers there with what the server said. Either way the session is a cookie
// that no script here gets to see.
export const followClient = new FollowClient({
  credentials: "include",
  timeout: 60_000,
  baseURL: env.VITE_API_URL,
  fetch: (input, options) => fetch(input, { ...options, cache: "no-store" }),
})

export const followApi = followAPIOf(followClient)

// A refused request may mean that the session ended, by itself or from another device. The
// server is asked, once however many requests it refuses at a time, and its answer signs the
// app out (see `userSyncService.whoami`), which asks the user to sign in again.
followClient.addResponseInterceptor(({ response }) => {
  if (response.status === 401 && whoami()) void fetchSessionUser().catch(() => {})
  return response
})

/**
 * Whether the API answers at all, checked the way ordinary requests travel. Any HTTP status
 * counts as an answer; the endpoint needs no session.
 */
const probeApiReachability = async () => {
  await fetch(`${env.VITE_API_URL}/status/configs`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  return true
}

const apiRecoveredListeners = new Set<() => void>()

/** Called when the API answers again after it could not be reached. */
export const onApiRecovered = (listener: () => void) => {
  apiRecoveredListeners.add(listener)
  return () => {
    apiRecoveredListeners.delete(listener)
  }
}

trackApiConnection(followClient, {
  probe: probeApiReachability,
  onUnreachable: () => setApiUnreachable(true),
  onRecovered: () => {
    setApiUnreachable(false)
    for (const listener of apiRecoveredListeners) {
      try {
        listener()
      } catch (error) {
        console.error("[api-connection] recovery listener threw", error)
      }
    }
  },
})
