import { dialog, shell } from "electron"

import { logger } from "~/logger"

import { t } from "./i18n"

/** Web pages and mail, which open without asking */
const OPENED_WITHOUT_ASKING = new Set(["http:", "https:", "mailto:"])

/**
 * Never handed to the system, not even when the user agrees: they run local files and programs
 * or reach file shares, as in known attacks through `shell.openExternal`
 */
const NEVER_OPENED = new Set([
  "data:",
  "file:",
  "jar:",
  "javascript:",
  "ms-msdt:",
  "res:",
  "search-ms:",
  "smb:",
  "vbscript:",
])

/** Long enough to tell the app and what the link asks of it, short enough for a dialog */
const SHOWN_URL_LENGTH = 200

const userAgreesToOpen = async (url: string) => {
  const shownUrl = url.length > SHOWN_URL_LENGTH ? `${url.slice(0, SHOWN_URL_LENGTH)}…` : url
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: t("dialog.openExternalApp.title"),
    message: t("dialog.openExternalApp.message", { url: shownUrl }),
    buttons: [t("dialog.open"), t("dialog.cancel")],
    defaultId: 1,
    cancelId: 1,
  })
  return response === 0
}

/**
 * Opens a link outside the app, the way every part of the app does: web pages and mail right
 * away, links of other apps once the user agrees, local files and programs never.
 *
 * @returns whether the link was opened
 */
export const openExternalSafely = async (url: string) => {
  let protocol: string
  try {
    ;({ protocol } = new URL(url))
  } catch {
    logger.warn("Did not open an external link that is not a URL")
    return false
  }

  if (NEVER_OPENED.has(protocol)) {
    logger.warn(`Did not open a ${protocol} link`)
    return false
  }
  if (!OPENED_WITHOUT_ASKING.has(protocol) && !(await userAgreesToOpen(url))) return false

  try {
    await shell.openExternal(url)
    return true
  } catch {
    // No app on the system takes the link
    logger.warn(`No app opened a ${protocol} link`)
    return false
  }
}
