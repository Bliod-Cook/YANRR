import { Logo } from "@follow/components/icons/logo.js"
import { nextFrame } from "@follow/utils/dom"
import * as React from "react"
import ReactDOM from "react-dom/client"
import { useTranslation } from "react-i18next"

import { initI18n } from "~/i18n"
import { removeAppSkeleton } from "~/lib/app"
import { ipcServices } from "~/lib/client"
import { WindowTitlebarRegion } from "~/modules/app/Titlebar"

import { ServerUrlForm } from "./ServerUrlForm"

const ServerSetupScreen = () => {
  const { t } = useTranslation("app")
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <WindowTitlebarRegion />
      <div data-testid="server-setup" className="flex w-[22rem] flex-col items-center gap-6">
        <Logo className="size-16" />
        <h1 className="text-2xl font-semibold">{t("server.title")}</h1>
        <ServerUrlForm />
      </div>
    </div>
  )
}

/** Shown by the desktop app instead of the app itself until the user has set a server */
export const renderServerSetup = async () => {
  await initI18n()
  ReactDOM.createRoot(document.querySelector("#root") as HTMLElement).render(
    <React.StrictMode>
      <ServerSetupScreen />
    </React.StrictMode>,
  )
  ipcServices?.app.readyToShowMainWindow()
  nextFrame(removeAppSkeleton)
}
