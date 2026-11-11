import type { ServerConfigs } from "@follow/store/api-contract"
import { createAtomHooks } from "@follow/utils/jotai"
import { atom } from "jotai"

export const [, , useServerConfigs, , getServerConfigs, setServerConfigs] = createAtomHooks(
  atom<Nullable<ServerConfigs>>(null),
)

/** Off until the server says otherwise, so a server without AI never shows its features */
export const useAiEnabled = () => useServerConfigs()?.ai === true

/** Off until the server says otherwise, so the sign-up form never shows on a closed server */
export const useRegistrationOpen = () => useServerConfigs()?.registration === true
