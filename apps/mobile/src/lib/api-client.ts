import { whoami } from "@follow/store/user/getters"
import { userActions, userSyncService } from "@follow/store/user/store"
import { trackApiConnection } from "@follow/utils/api-connection"
import { FollowClient } from "@follow-app/client-sdk"
import { fetch } from "expo/fetch"

import { setApiUnreachable } from "@/src/atoms/api-connection"

import { getAuthStateRevision, getCookie } from "./auth"
import { getUserAgent } from "./native/user-agent"
import { destination } from "./navigation/biz/Destination"
import { trackFetch } from "./network-activity"
import { SessionReadError } from "./network-error"
import { serverEnv } from "./server-env"
import { createUnauthorizedSessionCheck } from "./session-check"

// Tracked so a runtime reload can wait for the requests to settle first (see `reload-app.ts`).
const trackedFetch = trackFetch(fetch)

export const followClient = new FollowClient({
  credentials: "omit",
  timeout: 60_000,
  baseURL: serverEnv.API_URL,
  fetch: async (input, options = {}) => {
    if (!serverEnv.API_URL) throw new Error("No server address is set")
    return trackedFetch(input.toString(), options as any) as any
  },
})

export const followApi = followClient.api

// A keychain that cannot be read says nothing about the session, so the request fails to be
// tried again rather than going out without the cookie
const readSessionCookie = () =>
  getCookie().catch((cause: unknown) => {
    throw new SessionReadError({ cause })
  })

followClient.addRequestInterceptor(async (ctx) => {
  ctx.options.headers = {
    ...ctx.options.headers,
    "Cache-Control": "no-store",
    "User-Agent": await getUserAgent(),
    cookie: await readSessionCookie(),
  }
  return ctx
})

const signOutLocally = async () => {
  await userActions.removeCurrentUser()
  destination.Login()
}

// A revoked session keeps its cookie, so the cookie alone does not say the user is signed in.
const checkSessionAfterUnauthorized = createUnauthorizedSessionCheck({
  isSignedIn: () => !!whoami(),
  fetchSession: () => userSyncService.whoami(),
  getAuthRevision: getAuthStateRevision,
  onSessionGone: signOutLocally,
})

followClient.addResponseInterceptor(async (ctx) => {
  // With a cookie or without, the session endpoint decides whether the session is gone
  if (ctx.response.status === 401) void checkSessionAfterUnauthorized()
  return ctx.response
})

/** Whether the API answers at all. Any HTTP status counts; the endpoint needs no session. */
const probeApiReachability = async () => {
  await trackedFetch(`${serverEnv.API_URL}/status/configs`, {
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

// Without a server there is nothing to reach
if (serverEnv.API_URL) {
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
}
