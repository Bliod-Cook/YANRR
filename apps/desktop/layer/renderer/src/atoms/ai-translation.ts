import { atom } from "jotai"

import { createAtomHooks } from "~/lib/jotai"

import { useServerCapability } from "./server-configs"
import { useGeneralSettingKey } from "./settings/general"

// NOTE: We have three levels of settings can enable AI translation or Summary:
// 1. General setting, which is the global settings for all entries.
// 2. Action setting, which is defined in an action and applied to specific entries.
// 3. Toolbar control, which is a temporary setting for the current entry.
//
// When general setting or action setting is enabled, we should hide the toolbar control, which can save some space.
//
// Different from AI summary, AI translation also can show up in the entry list, which should only be controlled by the General setting or Action setting.

export const [, , useShowAITranslationOnce, , getShowAITranslationOnce, setShowAITranslationOnce] =
  createAtomHooks(atom<boolean>(false))

export const toggleShowAITranslationOnce = () => setShowAITranslationOnce((prev) => !prev)
export const enableShowAITranslationOnce = () => setShowAITranslationOnce(true)
export const disableShowAITranslationOnce = () => setShowAITranslationOnce(false)

// A server without AI never translates, whatever the settings say
export const useShowAITranslationAuto = (settings?: boolean | null) => {
  const aiEnabled = useServerCapability("ai")
  const enabledBySetting = useGeneralSettingKey("translation") || !!settings
  return aiEnabled && enabledBySetting
}

export const useShowAITranslation = (settings?: boolean | null) => {
  const aiEnabled = useServerCapability("ai")
  const showAITranslationAuto = useShowAITranslationAuto(settings)
  const showAITranslationOnce = useShowAITranslationOnce()
  return aiEnabled && (showAITranslationAuto || showAITranslationOnce)
}
