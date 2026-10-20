import type { BetterFetchOption } from "better-auth/client"
import { createAuthClient } from "better-auth/client"

export type AuthClient = ReturnType<typeof createAppAuthClient>

export const createAppAuthClient = ({
  apiURL,
  fetchOptions,
}: {
  apiURL: string
  fetchOptions?: BetterFetchOption
}) =>
  createAuthClient({
    baseURL: `${apiURL}/better-auth`,
    fetchOptions: {
      ...fetchOptions,
      credentials: "include",
      cache: "no-store",
    },
  })
