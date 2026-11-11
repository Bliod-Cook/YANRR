import { getStableRouterNavigate } from "@follow/components/atoms/route.js"
import { Routes } from "@follow/constants"
import { registerGlobalContext } from "@follow/shared/bridge"
import { invalidateUserSession } from "@follow/store/user/hooks"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router"
import { toast } from "sonner"

import { setWindowState } from "~/atoms/app"
import { useDialog, useModalStack } from "~/components/ui/modal/stacked/hooks"
import { useDiscoverRSSHubRouteModal } from "~/hooks/biz/useDiscoverRSSHubRoute"
import { useFollow } from "~/hooks/biz/useFollow"
import { navigateEntry } from "~/hooks/biz/useNavigateEntry"
import type { SettingModalOptions } from "~/modules/settings/modal/usePresentSettingModal"
import { usePresentSettingModal } from "~/modules/settings/modal/usePresentSettingModal"

declare module "@follow/components/providers/stable-router-provider.js" {
  interface CustomRoute {
    showSettings: (options?: SettingModalOptions) => void
  }
}

export const ExtensionExposeProvider = () => {
  const { present } = useModalStack()
  const showSettings = usePresentSettingModal()
  const location = useLocation()

  useEffect(() => {
    registerGlobalContext({
      goToDiscover: () => {
        getStableRouterNavigate()?.(Routes.Discover)
      },
      goToFeed: ({ id, view }: { id: string; view?: number }) => {
        navigateEntry({ feedId: id, view: view ?? 0, backPath: location.pathname })
      },
    })
  }, [location.pathname])

  useEffect(() => {
    registerGlobalContext({
      showSetting: (path) => window.router.showSettings(path),
      toast,
      navigateEntry,
    })
  }, [])
  useEffect(() => {
    // @ts-expect-error
    window.router ||= {}
    window.router.showSettings = showSettings
  }, [showSettings])

  const { t } = useTranslation()

  const follow = useFollow()
  const presentDiscoverRSSHubRoute = useDiscoverRSSHubRouteModal()
  useEffect(() => {
    registerGlobalContext({
      follow,
      rsshubRoute(route) {
        presentDiscoverRSSHubRoute(route)
      },
    })
  }, [follow, present, presentDiscoverRSSHubRoute, t])

  const dialog = useDialog()
  useEffect(() => {
    registerGlobalContext({
      dialog,
    })
  }, [dialog])

  useBindElectronBridge()

  useEffect(() => {
    registerGlobalContext({
      refreshSession: invalidateUserSession,
    })
  }, [])

  return null
}

const useBindElectronBridge = () => {
  useEffect(() => {
    registerGlobalContext({
      setWindowState,
    })
  }, [])
}
