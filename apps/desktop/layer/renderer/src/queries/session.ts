import { whoamiQueryKey } from "@follow/store/user/hooks"
import { userSyncService } from "@follow/store/user/store"
import { useQuery } from "@tanstack/react-query"

/** The session as the server last answered: `null` when nobody is signed in */
export const sessionQuery = {
  queryKey: whoamiQueryKey,
  queryFn: () => userSyncService.whoami(),
}

/**
 * Whether the server said that nobody is signed in, which is when the app asks to sign in.
 * Not while the answer is still out or the server cannot be reached: then the app goes on with
 * the user it last knew.
 */
export const useIsSignedOut = () => useQuery({ ...sessionQuery, enabled: false }).data === null
