import { PhCloudCheck } from "@follow/components/icons/PhCloudCheck.jsx"
import { PhCloudWarning } from "@follow/components/icons/PhCloudWarning.jsx"
import { PhCloudX } from "@follow/components/icons/PhCloudX.jsx"
import { RootPortal } from "@follow/components/ui/portal/index.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "@follow/components/ui/tooltip/index.jsx"
import { useIsOnline } from "@follow/hooks"
import { useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { useSettingContextSelector } from "../modal/hooks"
import { settingSyncQueue } from "./sync-queue"

const useSyncIndicator = () => {
  const { t } = useTranslation()
  const isOnline = useIsOnline()
  const canSync = useSettingContextSelector((s) => s.canSync)
  const status = useSyncExternalStore(settingSyncQueue.subscribe, settingSyncQueue.getStatus)

  if (!isOnline) {
    return { icon: <PhCloudX className="size-4" />, text: t("sync_indicator.offline") }
  }
  if (!canSync) {
    return { icon: <PhCloudWarning className="size-4" />, text: t("sync_indicator.disabled") }
  }
  if (status === "failed") {
    return { icon: <PhCloudWarning className="size-4" />, text: t("sync_indicator.failed") }
  }
  if (status === "pending") {
    return {
      icon: <i className="i-mgc-loading-3-cute-re size-4 animate-spin" />,
      text: t("sync_indicator.pending"),
    }
  }
  return { icon: <PhCloudCheck className="size-4" />, text: t("sync_indicator.synced") }
}

export const SettingSyncIndicator = () => {
  const { icon, text } = useSyncIndicator()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div role="img" aria-label={text} className="size-5">
          {icon}
        </div>
      </TooltipTrigger>
      <RootPortal>
        <TooltipContent>
          <div className="text-center text-xs">{text}</div>
        </TooltipContent>
      </RootPortal>
    </Tooltip>
  )
}
