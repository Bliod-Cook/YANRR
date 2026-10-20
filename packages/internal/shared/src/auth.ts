import type { BetterFetchOption } from "better-auth/client"
import { createAuthClient } from "better-auth/client"

export type AuthClient = ReturnType<typeof createFoloAuthClient>

export const createFoloAuthClient = ({
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
