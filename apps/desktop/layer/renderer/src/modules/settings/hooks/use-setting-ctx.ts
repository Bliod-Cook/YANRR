import { useMemo } from "react"

import { useDebugFeatureValue } from "~/atoms/debug-feature"
import { useIsInMASReview, useServerConfigs } from "~/atoms/server-configs"

import { getMemoizedSettings } from "../settings-glob"
import type { SettingPageContext } from "../utils"

export const useSettingPageContext = (): SettingPageContext => {
  const isInMASReview = useIsInMASReview()
  return useMemo(() => ({ isInMASReview }), [isInMASReview])
}

export const useAvailableSettings = () => {
  const ctx = useSettingPageContext()
  const serverConfigs = useServerConfigs()
  const debugFeatureValue = useDebugFeatureValue()
  return useMemo(
    () => getMemoizedSettings().filter((t) => !t.loader.hideIf?.(ctx)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, serverConfigs, debugFeatureValue],
  )
}
