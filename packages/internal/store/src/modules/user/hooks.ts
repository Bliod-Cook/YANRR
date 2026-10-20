import { useQuery } from "@tanstack/react-query"

import { api, queryClient } from "../../context"
import type { GeneralQueryOptions } from "../../types"
import { isNewUserQueryKey, whoamiQueryKey } from "./constants"
import type { UserStore } from "./store"
import { userSyncService, useUserStore } from "./store"

export { whoamiQueryKey } from "./constants"

export const invalidateUserSession = () => {
  queryClient().invalidateQueries({
    queryKey: whoamiQueryKey,
  })
}

/**
 * Fetch the session once, through the query cache. App start-up needs the session before any
 * component is mounted; going through the cache lets every `whoamiQueryKey` observer that
 * mounts afterwards reuse this result instead of asking for the session again.
 */
export const fetchSessionUser = () =>
  queryClient().fetchQuery({
    queryKey: whoamiQueryKey,
    queryFn: () => userSyncService.whoami(),
    staleTime: 0,
  })

export const usePrefetchSessionUser = () =>
  useQuery({
    queryKey: whoamiQueryKey,
    queryFn: () => userSyncService.whoami(),
  })

const whoamiSelector = (state: UserStore) => state.whoami
export const useWhoami = () => {
  return useUserStore(whoamiSelector)
}

const loggedInSelector = (state: UserStore) => !!state.whoami
export const useIsLoggedIn = () => {
  return useUserStore(loggedInSelector)
}
export function useIsNewUser(options?: GeneralQueryOptions) {
  const { data } = useQuery({
    enabled: options?.enabled,
    queryKey: isNewUserQueryKey,
    queryFn: async () => {
      const subscriptions = await api().subscriptions.get({})
      return subscriptions.data.length < 5
    },
  })
  return !!data
}
