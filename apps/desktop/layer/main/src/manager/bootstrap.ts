import { rmSync } from "node:fs"

import { electronApp, optimizer } from "@electron-toolkit/utils"
import { DEV, LEGACY_APP_PROTOCOL } from "@follow/shared/constants"
import { env } from "@follow/shared/env.desktop"
import { createBuildSafeHeaders } from "@follow/utils/headers"
import { app, BrowserWindow, net, protocol, session } from "electron"
import { join } from "pathe"

import { WindowManager } from "~/manager/window"

import { isMacOS } from "../env"
import { dedupeManagedAuthCookies } from "../lib/auth-cookies"
import { isDeepLink, openDeepLink, setDeepLinkHandler } from "../lib/deep-link"
import { handleUrlRouting } from "../lib/router"
import { logger } from "../logger"
import { AppManager } from "./app"

const buildSafeHeaders = createBuildSafeHeaders(env.VITE_WEB_URL, [
  env.VITE_API_URL,
  "https://readwise.io",
])

export class BootstrapManager {
  public static start() {
    AppManager.init()

    const gotTheLock = app.requestSingleInstanceLock()
    if (!gotTheLock) {
      app.quit()
      return
    }

    this.registerAppEvents()
  }

  private static registerAppEvents() {
    app.on("second-instance", (_, commandLine) => {
      const mainWindow = WindowManager.getMainWindow()
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        WindowManager.showMainWindow(mainWindow)
      }

      const url = commandLine.find(isDeepLink)
      if (url) {
        openDeepLink(url)
      }
    })

    // Registered before the app is ready: macOS sends the link that launched the app right away
    // and doesn't send it again
    app.on("open-url", (event, url) => {
      event.preventDefault()
      if (app.isReady()) {
        const mainWindow = WindowManager.getMainWindowOrCreate()
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
        }
      }
      if (url) {
        openDeepLink(url)
      }
    })

    app.whenReady().then(async () => {
      protocol.handle("app", (request) => {
        try {
          const urlObj = new URL(request.url)
          return net.fetch(`file://${urlObj.pathname}`)
        } catch {
          logger.error("app protocol error", request.url)
          return new Response("Not found", { status: 404 })
        }
      })

      app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      electronApp.setAppUserModelId(`re.${LEGACY_APP_PROTOCOL}`)

      session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders = buildSafeHeaders({
          url: details.url,
          headers: details.requestHeaders,
        })

        callback({ cancel: false, requestHeaders: details.requestHeaders })
      })

      // A failed cookie cleanup must not keep the main window from opening
      try {
        await dedupeManagedAuthCookies({
          apiURL: env.VITE_API_URL,
          session: session.defaultSession,
        })
      } catch (error) {
        logger.error("Failed to clean up auth cookies:", error)
      }

      WindowManager.getMainWindowOrCreate()

      setDeepLinkHandler(handleUrlRouting)
      // Windows and Linux pass the link that launched the app as an argument
      for (const arg of process.argv) {
        if (isDeepLink(arg)) openDeepLink(arg)
      }

      if (DEV) {
        this.installDevTools()
      }
    })

    app.on("before-quit", async () => {
      const window = WindowManager.getMainWindow()
      if (!window || window.isDestroyed()) return
      WindowManager.saveMainWindowState(window)
      await session.defaultSession.cookies.flushStore()
    })

    app.on("window-all-closed", () => {
      if (!isMacOS) {
        app.quit()
      }
    })

    app.on("before-quit", () => {
      const windows = BrowserWindow.getAllWindows()
      windows.forEach((window) => window.destroy())

      if (import.meta.env.DEV) {
        const cacheDir = join(app.getPath("userData"), "Cache")
        const codeCacheDir = join(app.getPath("userData"), "Code Cache")

        rmSync(cacheDir, { recursive: true, force: true })
        rmSync(codeCacheDir, { recursive: true, force: true })
      }
    })
  }

  private static installDevTools() {
    import("electron-devtools-installer").then(
      ({ default: installExtension, REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS }) => {
        ;[
          REDUX_DEVTOOLS,
          REACT_DEVELOPER_TOOLS,
          { id: "acndjpgkpaclldomagafnognkcgjignd" },
        ].forEach((extension) => {
          installExtension(extension, {
            loadExtensionOptions: { allowFileAccess: true },
          })
            .then((extension) => console.info(`Added Extension:  ${extension.name}`))
            .catch((err) => console.info("An error occurred:", err))
        })

        session.defaultSession.getAllExtensions().forEach((e) => {
          session.defaultSession.loadExtension(e.path)
        })
      },
    )
  }
}
