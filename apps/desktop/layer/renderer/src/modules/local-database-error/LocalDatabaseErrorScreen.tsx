import { Button } from "@follow/components/ui/button/index.js"
import { SyncTransactionService } from "@follow/database/services/sync-transaction"
import { IN_ELECTRON } from "@follow/shared/constants"
import { nextFrame } from "@follow/utils/dom"
import { StrictMode, useEffect, useState } from "react"
import type { Root } from "react-dom/client"
import { useTranslation } from "react-i18next"

import { removeAppSkeleton } from "~/lib/app"
import { ipcServices } from "~/lib/client"
import { WindowTitlebarRegion } from "~/modules/app/Titlebar"
import { clearLocalPersistStoreData } from "~/store/utils/clear"

// The outbox is in the database too; when it cannot be read either, nothing is known about it
const hasUnsentChanges = async () => {
  try {
    return (await SyncTransactionService.getAll()).length > 0
  } catch {
    return false
  }
}

const reload = () => window.location.reload()

const resetLocalDatabase = async () => {
  try {
    await clearLocalPersistStoreData()
  } finally {
    // A database that could not be deleted fails again and brings this screen back
    reload()
  }
}

export const LocalDatabaseErrorScreen = ({ error }: { error: unknown }) => {
  const { t } = useTranslation("app")
  const [unsentChanges, setUnsentChanges] = useState(false)

  useEffect(() => {
    void hasUnsentChanges().then(setUnsentChanges)
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-background p-8">
      {IN_ELECTRON && <WindowTitlebarRegion />}
      <div className="flex w-full max-w-prose select-text flex-col items-center gap-4 text-center">
        <i className="i-mgc-warning-cute-re size-12 text-red" />
        <h1 className="text-xl font-semibold">{t("local_database_error.title")}</h1>
        <p className="text-sm text-text-secondary">{t("local_database_error.description")}</p>
        <pre className="max-h-32 w-full overflow-auto whitespace-pre-wrap rounded-md bg-fill-secondary p-3 text-left font-mono text-xs text-text-secondary">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        {unsentChanges && (
          <p className="text-sm text-orange">{t("local_database_error.unsent_changes")}</p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" onClick={resetLocalDatabase}>
            {t("errors_page.reset_local_database")}
          </Button>
          <Button onClick={reload}>{t("retry", { ns: "common" })}</Button>
        </div>
      </div>
    </div>
  )
}

/** Shown instead of the app when its local database cannot be opened or loaded */
export const showLocalDatabaseError = (root: Root, error: unknown) => {
  root.render(
    <StrictMode>
      <LocalDatabaseErrorScreen error={error} />
    </StrictMode>,
  )
  ipcServices?.app.readyToShowMainWindow()
  nextFrame(removeAppSkeleton)
}
