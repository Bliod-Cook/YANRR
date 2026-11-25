import fsp from "node:fs/promises"

import { callWindowExpose } from "@follow/shared/bridge"
import type { BrowserWindow } from "electron"
import { app, clipboard, dialog, shell } from "electron"
import { getIpcContext, IpcMethod, IpcService } from "electron-ipc-decorator"
import path from "pathe"

import { START_IN_TRAY_ARGS } from "~/constants/app"
import { isMacOS } from "~/env"
import { getCacheDir } from "~/lib/cache"
import { setRendererReady } from "~/lib/deep-link"
import { getDownloadFileName } from "~/lib/download-file-name"
import { i18n } from "~/lib/i18n"
import { getSessions } from "~/lib/sessions"
import { store, StoreKey } from "~/lib/store"
import { getTrayConfig, registerAppTray } from "~/lib/tray"
import { logger, revealLogFile } from "~/logger"
import { AppManager } from "~/manager/app"
import { WindowManager } from "~/manager/window"

import { downloadFile } from "../../lib/download"

interface WindowActionInput {
  action: "close" | "minimize" | "maximum"
}

interface ExportCurrentPageAsPdfInput {
  defaultPath?: string
}

interface Sender extends Electron.WebContents {
  getOwnerBrowserWindow: () => Electron.BrowserWindow | null
}

const ensurePdfExtension = (filePath: string) => {
  return path.extname(filePath).toLowerCase() === ".pdf" ? filePath : `${filePath}.pdf`
}

/**
 * Whether the app was launched at login and should start hidden in the tray. Windows passes the
 * login item arguments to the app (see `START_IN_TRAY_ARGS`); macOS ignores them, so check how the
 * app was launched instead. Only when the tray icon is enabled, otherwise nothing would be left on
 * Windows to bring the window back.
 */
const shouldStartInTray = () => {
  if (!getTrayConfig()) return false
  if (process.argv.includes(START_IN_TRAY_ARGS)) return true
  return isMacOS && app.getLoginItemSettings().wasOpenedAtLogin
}

export class AppService extends IpcService {
  static override readonly groupName = "app"

  @IpcMethod()
  getAppVersion(): string {
    return app.getVersion()
  }

  @IpcMethod()
  switchAppLocale(input: string): void {
    i18n.changeLanguage(input)
    AppManager.registerMenuAndContextMenu()
    registerAppTray()

    app.commandLine.appendSwitch("lang", input)
  }

  @IpcMethod()
  windowAction(input: WindowActionInput): void {
    const { sender } = getIpcContext()
    if (sender.getType() === "window") {
      const window: BrowserWindow | null = (sender as Sender).getOwnerBrowserWindow()

      if (!window) return
      switch (input.action) {
        case "close": {
          window.close()
          break
        }
        case "minimize": {
          window.minimize()
          break
        }
        case "maximum": {
          if (window.isMaximized()) {
            window.unmaximize()
          } else {
            window.maximize()
          }
          break
        }
      }
    }
  }

  @IpcMethod()
  relaunch(): void {
    app.relaunch({
      // Inside an AppImage, `process.execPath` points into the FUSE mount, which
      // is unmounted once this process exits — the relauncher would then fail to
      // exec it and the app would simply quit. `$APPIMAGE` is the outer bundle.
      // It is undefined elsewhere, which keeps Electron's default behaviour.
      execPath: process.env.APPIMAGE,
      // Drop the autostart flag so a relaunch never resurrects the app hidden.
      args: process.argv.slice(1).filter((arg) => arg !== START_IN_TRAY_ARGS),
    })
    // `app.quit()` rather than `app.exit()`: the `before-quit` handler saves the
    // window bounds and writes the cookie store.
    app.quit()
  }

  @IpcMethod()
  readClipboard(): Promise<string> {
    return clipboard.readText()
  }

  /**
   * Saves the file at `input`, named after `nameUrl`: the original of an image the proxy serves.
   * Both are required, as the IPC types see a method with one optional more as taking one.
   */
  @IpcMethod()
  async download(input: string, nameUrl: string): Promise<void> {
    const { sender } = getIpcContext()
    const senderWindow = (sender as Sender).getOwnerBrowserWindow()
    const dialogOptions: Electron.SaveDialogOptions = {
      defaultPath: getDownloadFileName(nameUrl),
    }
    // Attached to the window it was asked from, like the PDF export
    const result = senderWindow
      ? await dialog.showSaveDialog(senderWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled) return

    try {
      await downloadFile(input, result.filePath)

      if (senderWindow && !senderWindow.isDestroyed()) {
        callWindowExpose(senderWindow).toast.success(i18n.t("download.success"), {
          duration: 1000,
        })
      }
    } catch (err) {
      if (senderWindow && !senderWindow.isDestroyed()) {
        callWindowExpose(senderWindow).toast.error(i18n.t("download.failed"), {
          duration: 1000,
        })
      }
      throw err
    }
  }

  @IpcMethod()
  async exportCurrentPageAsPdf(input: ExportCurrentPageAsPdfInput = {}): Promise<string | null> {
    const { sender } = getIpcContext()
    const senderWindow = (sender as Sender).getOwnerBrowserWindow()
    const dialogOptions: Electron.SaveDialogOptions = {
      defaultPath: ensurePdfExtension(input.defaultPath || "Untitled.pdf"),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    }
    const result = senderWindow
      ? await dialog.showSaveDialog(senderWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) return null

    const pdfData = await sender.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    })

    const filePath = ensurePdfExtension(result.filePath)
    await fsp.writeFile(filePath, pdfData)

    return filePath
  }

  @IpcMethod()
  readyToShowMainWindow() {
    const window = WindowManager.getMainWindow()
    if (window && getIpcContext().sender === window.webContents) {
      setRendererReady(true)
    }
    if (shouldStartInTray()) return
    if (window) WindowManager.showMainWindow(window)
  }

  @IpcMethod()
  openCacheFolder(): void {
    shell.openPath(getCacheDir())
  }

  @IpcMethod()
  getCacheLimit(): number {
    return store.get(StoreKey.CacheSizeLimit) || 0
  }

  @IpcMethod()
  async clearCache(): Promise<void> {
    // Through Chromium, which owns the cache files while the app runs, instead of deleting them
    // under it or, on Windows, running a batch file in a console window
    await Promise.all(
      getSessions().map((ses) =>
        ses.clearCache().catch((error) => {
          logger.error("Failed to clear cache", error)
        }),
      ),
    )
  }

  /** In megabytes, 0 for none. Applies from the next launch, see `applyCacheSizeLimit`. */
  @IpcMethod()
  limitCacheSize(input: number): void {
    if (input === 0) {
      store.delete(StoreKey.CacheSizeLimit)
    } else {
      store.set(StoreKey.CacheSizeLimit, input)
    }
  }

  @IpcMethod()
  revealLogFile() {
    return revealLogFile()
  }

  /** In bytes, the app page's cache and that of its webviews */
  @IpcMethod()
  async getCacheSize(): Promise<number> {
    const sizes = await Promise.all(getSessions().map((ses) => ses.getCacheSize()))
    return sizes.reduce((total, size) => total + size, 0)
  }

  @IpcMethod()
  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]!
  }

  @IpcMethod()
  async checkPathExists(input: string): Promise<boolean> {
    try {
      await fsp.access(input)
      return true
    } catch {
      return false
    }
  }
}
