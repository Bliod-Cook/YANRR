import { Button } from "@follow/components/ui/button/index.js"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router"

import { removeAppSkeleton } from "~/lib/app"
import { attachOpenInEditor } from "~/lib/dev"
import { clearLocalPersistStoreData } from "~/store/utils/clear"

import { PoweredByFooter } from "./PoweredByFooter"

export function ErrorElement() {
  const { t } = useTranslation()
  const error = useRouteError()
  const navigate = useNavigate()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : JSON.stringify(error)
  const stack = error instanceof Error ? error.stack : null

  useEffect(() => {
    removeAppSkeleton()
  }, [])

  useEffect(() => {
    console.error("Error handled by React Router default ErrorBoundary:", error)
  }, [error])

  // Electron loads the app from its index.html with a hash router, so the route is reset through
  // the router instead of navigating to the origin root. The URL only changes once the navigation
  // completes, so the reload waits for it.
  const reloadAtHome = async () => {
    await navigate("/")
    window.location.reload()
  }

  return (
    <div className="m-auto flex min-h-full max-w-prose flex-col p-8 pt-24 select-text">
      <div className="fixed inset-x-0 top-0 h-12 drag-region" />
      <div className="center flex flex-col">
        <i className="i-mgc-bug-cute-re size-12 text-red-400" />
        <h2 className="mt-12 mb-4 text-2xl">
          {t("errors_page.crashed_title", { appName: APP_NAME })}
        </h2>
      </div>
      <h3 className="text-xl">{message}</h3>
      {import.meta.env.DEV && stack ? (
        <pre className="mt-4 max-h-48 cursor-text overflow-auto rounded-md bg-red-50 p-4 text-left font-mono text-sm whitespace-pre-line text-red-600">
          {attachOpenInEditor(stack)}
        </pre>
      ) : null}

      <p className="my-8">{t("errors_page.temporary_problem", { appName: APP_NAME })}</p>

      <div className="center gap-4">
        <Button
          variant="outline"
          onClick={async () => {
            await clearLocalPersistStoreData()
            await reloadAtHome()
          }}
        >
          {t("errors_page.reset_local_database")}
        </Button>
        <Button onClick={reloadAtHome}>{t("errors_page.reload")}</Button>
      </div>

      <div className="grow" />

      <PoweredByFooter />
    </div>
  )
}
