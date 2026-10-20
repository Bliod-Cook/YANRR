import { useMemo } from "react"

import { useDebugFeatureValue } from "~/atoms/debug-feature"
import { useServerConfigs } from "~/atoms/server-configs"

import { getMemoizedSettings } from "../settings-glob"

export const useAvailableSettings = () => {
  const serverConfigs = useServerConfigs()
  const debugFeatureValue = useDebugFeatureValue()
  return useMemo(
    () => getMemoizedSettings().filter((t) => !t.loader.hideIf?.()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverConfigs, debugFeatureValue],
  )
}
