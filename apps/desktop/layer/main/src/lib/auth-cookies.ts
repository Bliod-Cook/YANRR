import { getApiUrl } from "@follow/utils/server-url"
import { session } from "electron"

// The session with the server lives in Chromium's cookie store and nowhere else: its network
// stack sends the cookie with the requests to the server and stores what the server sets.

// The server names it with the prefix when it is served over HTTPS
const SESSION_COOKIE_NAMES = ["__Secure-better-auth.session_token", "better-auth.session_token"]

/** Ends the session with `server` on this device, whether or not the server knows */
export const removeSessionCookies = async (server: string) => {
  const url = getApiUrl(server)
  await Promise.all(
    SESSION_COOKIE_NAMES.map((name) => session.defaultSession.cookies.remove(url, name)),
  )
}
