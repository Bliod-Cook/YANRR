import { Logo } from "@follow/components/icons/logo.jsx"
import { Wordmark } from "@follow/components/icons/wordmark.jsx"
import { ActionButton } from "@follow/components/ui/button/index.js"
import { stopPropagation } from "@follow/utils/dom"
import { cn } from "@follow/utils/utils"
import { m } from "motion/react"
import { memo, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"

import { setTimelineColumnShow, useSubscriptionColumnShow } from "~/atoms/sidebar"
import { useBackHome } from "~/hooks/biz/useNavigateEntry"
import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"
import { useI18n } from "~/hooks/common"
import { ProfileButton } from "~/modules/user/ProfileButton"

export const SubscriptionColumnHeader = memo(() => {
  const timelineId = useRouteParamsSelector((s) => s.timelineId)
  const navigateBackHome = useBackHome(timelineId)
  const navigate = useNavigate()
  const location = useLocation()
  const normalStyle = !window.electron || window.platform !== "darwin"
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "mr-3 ml-5 flex items-center",

        normalStyle ? "ml-4 justify-between" : "justify-end",
      )}
    >
      {normalStyle && (
        <div
          className="relative flex items-center gap-1 text-lg font-semibold"
          onClick={(e) => {
            e.stopPropagation()
            navigateBackHome()
          }}
        >
          <Logo className="mr-1 size-6" />
          <Wordmark />
        </div>
      )}
      <div className="relative flex items-center gap-2" onClick={stopPropagation}>
        <ActionButton
          data-testid="subscription-discover-trigger"
          shortcut="$mod+T"
          tooltip={t("words.discover")}
          onClick={() => {
            if (location.pathname !== "/discover") {
              navigate("/discover")
            }
          }}
        >
          <i className="i-mgc-add-cute-re size-5 text-text-secondary" />
        </ActionButton>

        <ProfileButton animatedAvatar />
        <LayoutActionButton />
      </div>
    </div>
  )
})

const LayoutActionButton = () => {
  const feedColumnShow = useSubscriptionColumnShow()

  const [animation, setAnimation] = useState({ width: !feedColumnShow ? "auto" : 0 })
  useEffect(() => {
    setAnimation({ width: !feedColumnShow ? "auto" : 0 })
  }, [feedColumnShow])

  const t = useI18n()

  if (feedColumnShow) return null

  return (
    <m.div initial={animation} animate={animation} className="overflow-hidden">
      <ActionButton
        tooltip={t("app.toggle_sidebar")}
        icon={
          <i
            className={cn(
              !feedColumnShow
                ? "i-mgc-layout-leftbar-open-cute-re"
                : "i-mgc-layout-leftbar-close-cute-re",
              "text-text-secondary",
            )}
          />
        }
        onClick={() => {
          setTimelineColumnShow(!feedColumnShow)
        }}
      />
    </m.div>
  )
}
