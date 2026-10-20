import { isMobile } from "@follow/components/hooks/useMobile.js"
import { IN_ELECTRON } from "@follow/shared/constants"
import { nextFrame } from "@follow/utils"
import { useEffect, useLayoutEffect, useRef } from "react"
import { Outlet } from "react-router"

import { useAppIsReady } from "./atoms/app"
import { useUISettingKey } from "./atoms/settings/ui"
import { removeAppSkeleton } from "./lib/app"
import { ipcServices } from "./lib/client"
import { appLog } from "./lib/log"
import { WindowTitlebarRegion } from "./modules/app/Titlebar"
import { RootProviders } from "./providers/root-providers"

function App() {
  return (
    <RootProviders>
      {IN_ELECTRON && <WindowTitlebarRegion />}

      <AppLayer />
    </RootProviders>
  )
}

const AppLayer = () => {
  const appIsReady = useAppIsReady()

  const onceReady = useRef(false)
  useLayoutEffect(() => {
    if (appIsReady && !onceReady.current) {
      onceReady.current = true
      ipcServices?.app.readyToShowMainWindow()
      nextFrame(removeAppSkeleton)
    }
  }, [appIsReady])

  useEffect(() => {
    // Measured once, when the app first renders its content instead of the skeleton
    if (!appIsReady) return
    const doneTime = Math.trunc(performance.now())
    appLog("App is ready", `${doneTime}ms`)
  }, [appIsReady])

  useEffect(() => {
    if (!isMobile()) return
    const handler = (e: MouseEvent) => {
      e.preventDefault()
    }
    document.addEventListener("contextmenu", handler)

    return () => {
      document.removeEventListener("contextmenu", handler)
    }
  }, [])

  return appIsReady ? <Outlet /> : <AppSkeleton />
}

const AppSkeleton = () => {
  const feedColWidth = useUISettingKey("feedColWidth")
  return (
    <div className="flex size-full">
      <div
        className="h-full shrink-0 bg-sidebar"
        style={{
          width: `${feedColWidth}px`,
        }}
      />
    </div>
  )
}

export { App as Component }
