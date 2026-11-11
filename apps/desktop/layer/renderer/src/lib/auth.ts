import { createAppAuthClient } from "@follow/shared/auth"
import { registerGlobalContext } from "@follow/shared/bridge"
import { env } from "@follow/shared/env.desktop"
import { getApiUrl } from "@follow/utils/server-url"

import { ipcServices } from "./client"
import { unregisterPushToken } from "./push-token"

// The auth client takes web addresses only, and the desktop app's API has none: it is on the
// page's own origin, where the main process answers for the server (see `api-client`). So the
// client is told the server's address, and its requests are sent to where the API is.
const serverApiUrl = getApiUrl(env.VITE_WEB_URL)

// The session is a cookie no script here gets to see, kept by the browser, or by Chromium for
// the main process. So signing in and up are the same requests in the desktop app and the web.
export const authClient = createAppAuthClient({
  apiURL: serverApiUrl,
  fetchOptions: {
    customFetchImpl: (input, init) =>
      fetch(String(input).replace(serverApiUrl, env.VITE_API_URL), init),
  },
})

// @keep-sorted
export const { changePassword, updateUser } = authClient

/** With the error the server refused the credentials with. Throws when it cannot be reached. */
export const signInWithEmail = async (email: string, password: string) => {
  const { error } = await authClient.signIn.email({ email, password })
  return { error }
}

/** Like `signInWithEmail`, for a new account, named after the mailbox until the user says more */
export const signUpWithEmail = async (email: string, password: string) => {
  const name = email.split("@")[0]!
  const { error } = await authClient.signUp.email({ email, password, name })
  return { error }
}

/**
 * Ends the session, with the error that kept it. Only the server can end the session of a
 * browser, whose scripts cannot drop the cookie. The desktop app can, so there the session
 * also ends while the server cannot be reached.
 */
export const endSession = async () => {
  if (ipcServices) {
    // First, while the session still stands: the server takes a push token off its user only
    await unregisterPushToken().catch(() => {})
    await ipcServices.auth.signOut()
    return { error: null }
  }
  const { error } = await authClient.signOut()
  return { error }
}

// The way the main process ends the session before it clears all data (macOS app menu)
registerGlobalContext({ endSession })
