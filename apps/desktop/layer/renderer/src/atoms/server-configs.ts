import { getStorageNS } from "@follow/utils/ns"
import type { ExtractResponseData, GetStatusConfigsResponse } from "@follow-app/client-sdk"
import { atomWithStorage } from "jotai/utils"

import { createAtomHooks } from "~/lib/jotai"

export const [, , useServerConfigs, , getServerConfigs, setServerConfigs] = createAtomHooks(
  atomWithStorage<Nullable<ExtractResponseData<GetStatusConfigsResponse>>>(
    getStorageNS("server-configs"),
    null,
    undefined,
    {
      getOnInit: true,
    },
  ),
)
