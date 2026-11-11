import { useWhoami } from "@follow/store/user/hooks"
import type { AuthClientError } from "@follow/utils/auth-error"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { toast } from "sonner"

import { useAppIsReady } from "~/atoms/app"
import { endSession, getSession as refreshBetterAuthSession } from "~/lib/auth"
import { ipcServices } from "~/lib/client"
import { getAuthErrorMessage, toastFetchError } from "~/lib/error-parser"
import { reloadAtAppRoot } from "~/lib/reload-at-app-root"
import { clearLocalSessionData } from "~/store/utils/clear"

import { sessionQuery } from "./session"

const sessionCookieRefreshInterval = 1000 * 60 * 60 * 12

let lastSessionCookieRefreshAt = 0
let sessionCookieRefreshPromise: Promise<unknown> | null = null

const refreshAuthSessionCookie = async () => {
  if (Date.now() - lastSessionCookieRefreshAt < sessionCookieRefreshInterval) {
    return
  }

  sessionCookieRefreshPromise ??= refreshBetterAuthSession()
    .then((result) => {
      if (!result?.error) {
        lastSessionCookieRefreshAt = Date.now()
      }
      return result
    })
    .catch(() => null)
    .finally(() => {
      sessionCookieRefreshPromise = null
    })

  await sessionCookieRefreshPromise
}

export const useSession = () => {
  const whoami = useWhoami()
  const appIsReady = useAppIsReady()
  const { data, isLoading, ...rest } = useQuery({
    ...sessionQuery,
    // Not before the local database is open: the answer is written to it
    enabled: appIsReady,
    refetchOnMount: true,
    // Start-up fetches the session through the same query, and several components mount this
    // hook right after. A short window lets them share that result; a login reloads the page.
    staleTime: 60_000,
  })
  const { error } = rest
  // Until the server answers, and while it cannot be reached, the user this device last knew
  const session =
    data === undefined && whoami ? ({ user: whoami } as NonNullable<typeof data>) : data

  const getAuthStatus = ():
    "loading" | "authenticated" | "error" | "unauthenticated" | "unknown" => {
    if (session) {
      return "authenticated"
    }

    if (error) {
      return "error"
    }

    if (isLoading) {
      return "loading"
    }

    if (data === null) {
      return "unauthenticated"
    }

    return "unknown"
  }

  return {
    session,
    ...rest,
    status: getAuthStatus(),
  } as const
}

export const useAuthSessionCookieRefresh = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const refresh = () => {
      if (document.visibilityState !== "hidden") {
        void refreshAuthSessionCookie()
      }
    }

    refresh()

    const interval = window.setInterval(refresh, sessionCookieRefreshInterval)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [enabled])
}

/**
 * Whether a request of `~/lib/auth` went through. Otherwise the user is told why not: what the
 * server refused it with, or that the server could not be reached.
 */
export const succeededOrToast = async (
  request: () => Promise<{ error: AuthClientError | null }>,
) => {
  try {
    const { error } = await request()
    if (!error) return true
    toast.error(getAuthErrorMessage(error))
  } catch (error) {
    toastFetchError(error as Error)
  }
  return false
}

/** Starts the app over as the user who just signed in */
export const handleSessionChanges = () => {
  ipcServices?.auth.sessionChanged()
  window.location.reload()
}

/** Signs out and starts over without the account's data, which stays while the session does */
export const signOut = async () => {
  if (!(await succeededOrToast(endSession))) return

  await clearLocalSessionData()
  reloadAtAppRoot()
}
