import { atom } from "jotai"

import { createAtomHooks } from "~/lib/jotai"

import { useServerCapability } from "./server-configs"
import { useGeneralSettingKey } from "./settings/general"

export const [, , useShowAISummaryOnce, , getShowAISummaryOnce, setShowAISummaryOnce] =
  createAtomHooks(atom<boolean>(false))

export const toggleShowAISummaryOnce = () => setShowAISummaryOnce((prev) => !prev)
export const enableShowAISummaryOnce = () => setShowAISummaryOnce(true)
export const disableShowAISummaryOnce = () => setShowAISummaryOnce(false)

// A server without AI never shows a summary, whatever the settings say
export const useShowAISummaryAuto = (settings?: boolean | null) => {
  const aiEnabled = useServerCapability("ai")
  const enabledBySetting = useGeneralSettingKey("summary") || !!settings
  return aiEnabled && enabledBySetting
}

export const useShowAISummary = (settings?: boolean | null) => {
  const aiEnabled = useServerCapability("ai")
  const showAISummaryAuto = useShowAISummaryAuto(settings)
  const showAISummaryOnce = useShowAISummaryOnce()
  return aiEnabled && (showAISummaryAuto || showAISummaryOnce || !!settings)
}
