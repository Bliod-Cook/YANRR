import { callWindowExpose } from "@follow/shared/bridge"
import { dialog } from "electron"

import { getIconPath } from "~/helper"
import { WindowManager } from "~/manager/window"

import { t } from "./i18n"
import { getSessions } from "./sessions"

export const clearAllDataAndConfirm = async () => {
  const win = WindowManager.getMainWindow()
  if (!win) return

  // Dialog to confirm
  const result = await dialog.showMessageBox({
    type: "warning",
    icon: getIconPath(),
    message: t("dialog.clearAllData"),
    buttons: [t("dialog.yes"), t("dialog.no")],
    cancelId: 1,
  })

  if (result.response === 1) {
    return
  }
  return clearAllData()
}

const clearAllData = async () => {
  const win = WindowManager.getMainWindow()
  if (!win) return
  const caller = callWindowExpose(win)

  try {
    // The session ends the way a sign-out ends it, so the device also stops getting the
    // account's push notifications
    await caller.endSession()

    // The app page's data and what sites left in its webviews
    for (const ses of getSessions()) {
      await ses.clearCache()

      await ses.clearStorageData({
        storages: [
          "filesystem",
          "indexdb",
          "localstorage",
          "shadercache",
          "serviceworkers",
          "cookies",
        ],
      })
    }

    caller.toast.success(t("dialog.clearAllDataSuccess"))

    // reload the app
    win.reload()
  } catch (error) {
    caller.toast.error(
      t("dialog.clearAllDataFailed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}
