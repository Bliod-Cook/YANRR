import { expoClient } from "@better-auth/expo/client"
import { invalidateSessionUser, onLocalDataOfAnotherAccount } from "@follow/store/sync/account"
import { isNewUserQueryKey, whoamiQueryKey } from "@follow/store/user/constants"
import { userActions } from "@follow/store/user/store"
import { normalizeServerUrl } from "@follow/utils/server-url"
import type { BetterAuthClientOptions } from "better-auth/client"
import { createAuthClient } from "better-auth/react"

import { createSessionAwareAuthCookieStorage } from "./auth-cookie-sync"
import { scheduleLocalDataReset } from "./local-data-reset"
import { getUserAgent } from "./native/user-agent"
import { Navigation } from "./navigation/Navigation"
import { unregisterPushToken } from "./push-token"
import { queryClient } from "./query-client"
import { reloadApp } from "./reload-app"
import { safeSecureStore } from "./secure-store"
import { answersAsServer, saveServerUrl, serverEnv } from "./server-env"

const storagePrefix = "follow_auth"
export const cookieKey = `${storagePrefix}_cookie`
export const sessionTokenKey = "__Secure-better-auth.session_token"
const sessionDataKey = `${storagePrefix}_session_data`

let authStateRevision = 0
/**
 * Set while signing out, which ends in a reload with an empty database. The session's queries
 * are not loaded again before it: without the session the server would only refuse them.
 */
let signingOut = false

export const getAuthStateRevision = () => authStateRevision

// Session-scoped queries must be reset on auth transitions, otherwise mounted timeline
// queries can keep rendering anonymous cache under the new session.
const refreshSessionQueries = () =>
  Promise.allSettled([
    queryClient.invalidateQueries({ queryKey: whoamiQueryKey }),
    queryClient.invalidateQueries({ queryKey: isNewUserQueryKey }),
    queryClient.resetQueries({ queryKey: ["entries"] }),
    queryClient.resetQueries({ queryKey: ["subscription"] }),
    queryClient.resetQueries({ queryKey: ["unread"] }),
    queryClient.resetQueries({ queryKey: ["action", "rules"] }),
  ])

type MobileAuthClientOptions = Omit<BetterAuthClientOptions, "plugins"> & {
  plugins: [ReturnType<typeof expoClient>]
}

const authCookieStorage = createSessionAwareAuthCookieStorage({
  cookieKey,
  storage: safeSecureStore,
  onSessionChange() {
    authStateRevision += 1
    // Whose session it is stays unknown until the session endpoint answers, so queued changes
    // are not sent with it before.
    invalidateSessionUser()
    // The Expo plugin drops the stored session as the sign-out request leaves
    if (!signingOut) void refreshSessionQueries()
  },
})

export const authClient = createAuthClient<MobileAuthClientOptions>({
  // Until the user has set a server there is no address, and better-auth refuses a relative one
  baseURL: serverEnv.API_URL ? `${serverEnv.API_URL}/better-auth` : undefined,
  fetchOptions: {
    cache: "no-store",
    // Learn more: https://better-fetch.vercel.app/docs/hooks
    onRequest: async (ctx) => {
      ctx.headers.set("User-Agent", await getUserAgent())
      // React Native sends no origin, and the server refuses state-changing requests that carry
      // the session cookie without its own
      ctx.headers.set("Origin", new URL(serverEnv.WEB_URL).origin)

      return ctx
    },
  },
  plugins: [
    expoClient({
      scheme: "yanrr",
      storagePrefix,
      storage: authCookieStorage,
      // The signed-in user comes from the user store; a copy of the session would go unread
      disableCache: true,
    }),
  ],
})

// @keep-sorted
export const { changePassword, getCookie, signIn, signUp } = authClient

const clearAuthStorage = async () => {
  const keys = [cookieKey, sessionTokenKey, sessionDataKey]
  await Promise.all(keys.map((key) => safeSecureStore.removeItemAsync(key)))
}

/**
 * Reload with nothing of the account on the device; the app then starts over for the current
 * session.
 */
const resetLocalData = async (reason: string) => {
  scheduleLocalDataReset("account")
  await reloadApp(reason)
}

/**
 * Switches to the server at the address the user typed, once it answers like one. The session
 * and the data on this device belong to the server before, so the app starts over.
 */
export const setServerUrl = async (input: string): Promise<"invalid" | "unreachable" | null> => {
  const server = normalizeServerUrl(input)
  if (!server) return "invalid"
  if (!(await answersAsServer(server))) return "unreachable"

  await clearAuthStorage()
  saveServerUrl(server)
  await resetLocalData("Server changed")
  return null
}

export const signOut = async () => {
  // While the session still authorizes the request
  await unregisterPushToken()
  signingOut = true
  try {
    await authClient.signOut()
  } catch (error) {
    console.warn(
      `[auth] Remote sign out failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  await clearAuthStorage()
  await userActions.removeCurrentUser()
  Navigation.rootNavigation.popToRoot()
  authStateRevision += 1
  try {
    await resetLocalData("User sign out")
  } catch (error) {
    // Without the reload the screens would keep the signed-out account's data
    await refreshSessionQueries()
    throw error
  } finally {
    signingOut = false
  }
}

let resettingForAnotherAccount = false
// Signed in to another account than the one whose data is on this device, after that one's
// session ended without a sign-out. The data on screen and the changes still queued belong to
// the account before, so start over as a sign-out does, keeping the new session.
onLocalDataOfAnotherAccount(() => {
  if (resettingForAnotherAccount) return
  resettingForAnotherAccount = true
  Navigation.rootNavigation.popToRoot()
  void resetLocalData("Signed in to another account")
})
