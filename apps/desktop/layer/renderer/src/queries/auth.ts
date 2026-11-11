import { useWhoami } from "@follow/store/user/hooks"
import type { AuthClientError } from "@follow/utils/auth-error"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"

import { useAppIsReady } from "~/atoms/app"
import { endSession } from "~/lib/auth"
import { getAuthErrorMessage, toastFetchError } from "~/lib/error-parser"
import { reloadAtAppRoot } from "~/lib/reload-at-app-root"
import { clearLocalSessionData } from "~/store/utils/clear"

import { sessionQuery } from "./session"

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
  window.location.reload()
}

/** Signs out and starts over without the account's data, which stays while the session does */
export const signOut = async () => {
  if (!(await succeededOrToast(endSession))) return

  await clearLocalSessionData()
  reloadAtAppRoot()
}
