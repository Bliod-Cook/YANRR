// Registers the "messaging" sync model before the sync engine starts.
import "./lib/web-push-registration"

import { IN_ELECTRON, WEB_BUILD } from "@follow/shared/constants"
import {
  aiEnabledContext,
  apiContext,
  authClientContext,
  queryClientContext,
  syncApiContext,
} from "@follow/store/context"
import * as React from "react"
import { flushSync } from "react-dom"
import ReactDOM from "react-dom/client"
import { RouterProvider } from "react-router/dom"

import { authClient } from "~/lib/auth"

import { setAppIsReady } from "./atoms/app"
import { getFeature } from "./hooks/biz/useFeature"
import { initializeApp } from "./initialize"
import { registerAppGlobalShortcuts } from "./initialize/global-shortcuts"
import { followApi } from "./lib/api-client"
import { queryClient } from "./lib/query-client"
import { router } from "./router"

authClientContext.provide(authClient)
queryClientContext.provide(queryClient)
apiContext.provide(followApi)
syncApiContext.provide(followApi.sync)
aiEnabledContext.provide(() => getFeature("ai"))

initializeApp().finally(() => {
  import("./push-notification").then(({ registerWebPushNotifications }) => {
    if (navigator.serviceWorker && WEB_BUILD) {
      registerWebPushNotifications()
    }
  })

  flushSync(() => setAppIsReady(true))
})

const $container = document.querySelector("#root") as HTMLElement

if (!IN_ELECTRON) {
  registerAppGlobalShortcuts()
}

ReactDOM.createRoot($container).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
