import type {
  BetterAuthClientOptions,
  BetterAuthClientPlugin,
  BetterFetchOption,
} from "better-auth/client"
import { createAuthClient } from "better-auth/client"
import { inferAdditionalFields } from "better-auth/client/plugins"

export const baseAuthPlugins = [
  inferAdditionalFields({
    user: {
      handle: {
        type: "string",
        required: false,
      },
      bio: {
        type: "string",
        required: false,
      },
      website: {
        type: "string",
        required: false,
      },
      socialLinks: {
        type: "json",
        required: false,
      },
    },
  }),
] as const satisfies readonly BetterAuthClientPlugin[]

export type BaseAuthPlugins = [...typeof baseAuthPlugins]

export type FoloAuthClientOptions<ExtraPlugins extends BetterAuthClientPlugin[] = []> = Omit<
  BetterAuthClientOptions,
  "plugins"
> & {
  plugins: [...BaseAuthPlugins, ...ExtraPlugins]
}

export type AuthClient<ExtraPlugins extends BetterAuthClientPlugin[] = []> = ReturnType<
  typeof createAuthClient<FoloAuthClientOptions<ExtraPlugins>>
>

export const createFoloAuthClient = ({
  apiURL,
  fetchOptions,
}: {
  apiURL: string
  fetchOptions?: BetterFetchOption
}): AuthClient =>
  createAuthClient<FoloAuthClientOptions>({
    baseURL: `${apiURL}/better-auth`,
    plugins: [...baseAuthPlugins],
    fetchOptions: {
      ...fetchOptions,
      credentials: "include",
      cache: "no-store",
    },
  })
