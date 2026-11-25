import { env } from "@follow/shared/env.desktop"
import { useTranslation } from "react-i18next"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { clearLocalSessionData } from "~/store/utils/clear"

import { ServerUrlForm } from "./ServerUrlForm"

// Data and settings on this device belong to an account of the server before
const ChangeServerForm = () => (
  <div className="w-80">
    <ServerUrlForm beforeRelaunch={clearLocalSessionData} />
  </div>
)

/** The server the desktop app signs in to, with a way to switch to another one */
export const CurrentServer = () => {
  const { t } = useTranslation("app")
  const { present } = useModalStack()

  return (
    <div className="flex items-center justify-center gap-1.5 text-sm text-text-secondary">
      <span>{t("server.current", { host: new URL(env.VITE_WEB_URL).host })}</span>
      <span aria-hidden>·</span>
      <button
        data-testid="server-change"
        type="button"
        className="text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none"
        onClick={() => present({ title: t("server.title"), content: ChangeServerForm })}
      >
        {t("server.change")}
      </button>
    </div>
  )
}
