import type { ServerConfigs as ServerContractConfigs } from "@follow/store/api-contract"
import { atom } from "jotai"

import { createAtomHooks } from "~/lib/jotai"

/** What the server offers, from `GET /status/configs` */
export interface ServerConfigs extends ServerContractConfigs {
  /** The server never sends it: AI chat does not exist on it */
  AI_CHAT_ENABLED?: boolean
}

// Not persisted: an answer kept from another server would be wrong
export const [, , useServerConfigs, , getServerConfigs, setServerConfigs] = createAtomHooks(
  atom<Nullable<ServerConfigs>>(null),
)

/** Off until the server says it is on, so no feature shows that the server cannot serve */
export const useServerCapability = (capability: "ai" | "registration" | "push" | "mcp") =>
  useServerConfigs()?.[capability] === true
