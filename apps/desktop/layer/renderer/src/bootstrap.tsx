// Registers the "messaging" sync model before the sync engine starts.
import "./lib/web-push-registration"

import { IN_ELECTRON, WEB_BUILD } from "@follow/shared/constants"
import {
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
import { initializeApp } from "./initialize"
import { registerAppGlobalShortcuts } from "./initialize/global-shortcuts"
import { exposeHistoryIsPop } from "./initialize/history"
import { followApi } from "./lib/api-client"
import { queryClient } from "./lib/query-client"
import { showLocalDatabaseError } from "./modules/local-database-error/LocalDatabaseErrorScreen"
import { router } from "./router"

authClientContext.provide(authClient)
queryClientContext.provide(queryClient)
apiContext.provide(followApi)
syncApiContext.provide(followApi.sync)

exposeHistoryIsPop(router)

if (!IN_ELECTRON) {
  registerAppGlobalShortcuts()
}

const root = ReactDOM.createRoot(document.querySelector("#root") as HTMLElement)

initializeApp().then(
  () => {
    flushSync(() => setAppIsReady(true))

    if (WEB_BUILD && navigator.serviceWorker) {
      void import("./push-notification").then(
        ({ listenToNotificationClicks, registerWebPushNotifications }) => {
          listenToNotificationClicks()
          void registerWebPushNotifications()
        },
      )
    }
  },
  (error: unknown) => {
    console.error("The local database could not be opened", error)
    showLocalDatabaseError(root, error)
  },
)

root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
