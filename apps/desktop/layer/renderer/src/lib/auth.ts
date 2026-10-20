import { createFoloAuthClient } from "@follow/shared/auth"
import { buildBetterAuthSessionTokenCookieHeader } from "@follow/shared/auth-cookie"
import { IN_ELECTRON } from "@follow/shared/constants"
import { env } from "@follow/shared/env.desktop"
import { createDesktopAPIHeaders } from "@follow/utils/headers"
import PKG from "@pkg"

import { fetchWithElectronAuth } from "./api-client"
import { getAuthSessionToken } from "./client-session"

const headers = createDesktopAPIHeaders({ version: PKG.version })

export const authClient = createFoloAuthClient({
  apiURL: env.VITE_API_URL,
  fetchOptions: {
    headers,
    // Electron's pages come from `app://`, an origin the server refuses; the main process sends
    // the requests with the server's own origin and the session cookie
    ...(IN_ELECTRON && {
      customFetchImpl: (input, init) => fetchWithElectronAuth(new Request(input, init)),
    }),
    onRequest: (context) => {
      const authSessionToken = IN_ELECTRON ? getAuthSessionToken() : null
      if (authSessionToken) {
        context.headers.set(
          "Cookie",
          buildBetterAuthSessionTokenCookieHeader(env.VITE_API_URL, authSessionToken),
        )
      }
    },
  },
})

// @keep-sorted
export const { changePassword, getSession, signIn, signOut, signUp, updateUser } = authClient
