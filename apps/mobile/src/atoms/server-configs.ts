import { createAtomHooks } from "@follow/utils/jotai"
import { atom } from "jotai"

/** What the server offers, from `GET /status/configs` */
export interface ServerConfigs {
  /** Summaries and translation are configured */
  ai: boolean
  /** Sign-up is accepted */
  registration: boolean
  push: boolean
}

export const [, , useServerConfigs, , getServerConfigs, setServerConfigs] = createAtomHooks(
  atom<Nullable<ServerConfigs>>(null),
)

/** Off until the server says otherwise, so a server without AI never shows its features */
export const useAiEnabled = () => useServerConfigs()?.ai === true

/** Off until the server says otherwise, so the sign-up form never shows on a closed server */
export const useRegistrationOpen = () => useServerConfigs()?.registration === true
