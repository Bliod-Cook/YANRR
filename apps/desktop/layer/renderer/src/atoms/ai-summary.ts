import { atom } from "jotai"

import { useFeature } from "~/hooks/biz/useFeature"
import { createAtomHooks } from "~/lib/jotai"

import { useGeneralSettingKey } from "./settings/general"

export const [, , useShowAISummaryOnce, , getShowAISummaryOnce, setShowAISummaryOnce] =
  createAtomHooks(atom<boolean>(false))

export const toggleShowAISummaryOnce = () => setShowAISummaryOnce((prev) => !prev)
export const enableShowAISummaryOnce = () => setShowAISummaryOnce(true)
export const disableShowAISummaryOnce = () => setShowAISummaryOnce(false)

export const useShowAISummaryAuto = (settings?: boolean | null) => {
  return useGeneralSettingKey("summary") || !!settings
}

export const useShowAISummary = (settings?: boolean | null) => {
  const aiEnabled = useFeature("ai")
  const showAISummaryAuto = useShowAISummaryAuto(settings)
  const showAISummaryOnce = useShowAISummaryOnce()
  return aiEnabled && (showAISummaryAuto || showAISummaryOnce || !!settings)
}
