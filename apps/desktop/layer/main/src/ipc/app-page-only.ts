import { ipcMain } from "electron"

import { getPageOrigin } from "~/lib/page-origin"

/**
 * Runs `register` with every IPC handler it registers answering the app's own pages only. The
 * handlers write files, open programs and change settings of the system, and whatever else ends
 * up in a window or a webview must not get to ask for that.
 */
export const registerForAppPageOnly = <T>(register: () => T): T => {
  const { handle } = ipcMain
  ipcMain.handle = (channel, listener) =>
    handle.call(ipcMain, channel, (event, ...args) => {
      // No frame once the one that asked has navigated or is gone
      if (event.senderFrame?.origin !== getPageOrigin()) {
        throw new Error(`Refused ${channel}: not asked by the app's page`)
      }
      return listener(event, ...args)
    })
  try {
    return register()
  } finally {
    ipcMain.handle = handle
  }
}
