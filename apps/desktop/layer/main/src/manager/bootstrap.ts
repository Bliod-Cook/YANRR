import { electronApp, optimizer } from "@electron-toolkit/utils"
import { APP_ID } from "@follow/shared/constants"
import { createBuildSafeHeaders } from "@follow/utils/headers"
import { getApiUrl } from "@follow/utils/server-url"
import { app, BrowserWindow, net, protocol, session } from "electron"

import { WindowManager } from "~/manager/window"

import { isMacOS } from "../env"
import { proxyApiRequest } from "../lib/api-proxy"
import { APP_API_URL } from "../lib/app-url"
import { applyCacheSizeLimit } from "../lib/cache"
import { isDeepLink, openDeepLink, setDeepLinkHandler } from "../lib/deep-link"
import { getPageOrigin } from "../lib/page-origin"
import { isPermissionGranted } from "../lib/permissions"
import { handleUrlRouting } from "../lib/router"
import { getServerUrl } from "../lib/server-url"
import { logger } from "../logger"
import { AppManager } from "./app"

/**
 * The answer to a request of the app's page for the server's API. A server that cannot be
 * reached fails the request, as it does in the web app.
 */
const answerApiRequest = async (request: Request) => {
  const server = getServerUrl()
  if (!server) return Response.error()
  try {
    return await proxyApiRequest(request, { server, pageOrigin: getPageOrigin() })
  } catch {
    return Response.error()
  }
}

export class BootstrapManager {
  public static start() {
    const gotTheLock = app.requestSingleInstanceLock()
    if (!gotTheLock) {
      app.quit()
      return
    }

    // Before the app is ready, when Chromium sets up its cache
    applyCacheSizeLimit()
    AppManager.init()
    this.registerAppEvents()
  }

  private static registerAppEvents() {
    app.on("second-instance", (_, commandLine) => {
      WindowManager.showMainWindow()

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
        WindowManager.showMainWindow(WindowManager.getMainWindowOrCreate())
      }
      if (url) {
        openDeepLink(url)
      }
    })

    // The Dock icon was clicked or the app launched again on macOS, where the window only hides
    app.on("activate", () => {
      WindowManager.showMainWindow(WindowManager.getMainWindowOrCreate())
    })

    app.whenReady().then(() => {
      protocol.handle("app", (request) => {
        if (request.url.startsWith(`${APP_API_URL}/`)) return answerApiRequest(request)
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

      electronApp.setAppUserModelId(APP_ID)

      const server = getServerUrl()
      const buildSafeHeaders = createBuildSafeHeaders(server ?? "", [
        server ? getApiUrl(server) : "",
      ])
      session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders = buildSafeHeaders({
          url: details.url,
          headers: details.requestHeaders,
        })

        callback({ cancel: false, requestHeaders: details.requestHeaders })
      })

      // Electron grants every permission a page asks for unless told otherwise
      session.defaultSession.setPermissionRequestHandler(
        (_webContents, permission, callback, details) => {
          callback(isPermissionGranted(permission, details.requestingUrl))
        },
      )
      session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin) =>
        isPermissionGranted(permission, origin),
      )

      WindowManager.getMainWindowOrCreate()

      setDeepLinkHandler(handleUrlRouting)
      // Windows and Linux pass the link that launched the app as an argument
      for (const arg of process.argv) {
        if (isDeepLink(arg)) openDeepLink(arg)
      }

      if (import.meta.env.DEV) {
        this.installDevTools()
      }
    })

    app.on("window-all-closed", () => {
      if (!isMacOS) {
        app.quit()
      }
    })

    // Quitting waits until the cookie store is written: Chromium may not get to it on the way
    // out, and a session just ended or begun would come back or be lost on the next launch
    let cookiesWritten = false
    app.on("before-quit", (event) => {
      if (cookiesWritten) return
      event.preventDefault()

      const window = WindowManager.getMainWindow()
      if (window && !window.isDestroyed()) WindowManager.saveMainWindowState(window)

      void session.defaultSession.cookies.flushStore().finally(() => {
        cookiesWritten = true
        // Closing would only hide the main window, see `bindMainWindowCloseHandlers`
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
        app.quit()
      })
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
