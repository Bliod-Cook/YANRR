import { fileURLToPath } from "node:url"

import { callWindowExpose, WindowState } from "@follow/shared/bridge"
import { APP_PROTOCOL } from "@follow/shared/constants"
import { SERVER_URL_ARG } from "@follow/shared/desktop-launch"
import type { BrowserWindowConstructorOptions } from "electron"
import { BrowserWindow, screen } from "electron"
import type { Event } from "electron/main"
import path from "pathe"

import { isMacOS, isWindows } from "~/env"
import { getIconPath } from "~/helper"
import { APP_ORIGIN } from "~/lib/app-url"
import { setRendererReady } from "~/lib/deep-link"
import { openExternalSafely } from "~/lib/open-external"
import { getDevServerUrl, isAppPage } from "~/lib/page-origin"
import { getServerUrl } from "~/lib/server-url"
import { WEBVIEW_PARTITION } from "~/lib/sessions"
import { store } from "~/lib/store"
import { getTrayConfig } from "~/lib/tray"
import { refreshBound } from "~/lib/utils"
import { logger } from "~/logger"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

class WindowManagerStatic {
  static get mainWindowDefaultSize() {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workAreaSize } = primaryDisplay
    return {
      height: workAreaSize.height,
      width: workAreaSize.width,
    }
  }

  // Window configuration properties for better DX
  private readonly config = {
    windowStateStoreKey: "windowState",
    minWindowSize: {
      width: 1024,
      height: 500,
    },
    macOSTrafficLight: {
      x: 18,
      y: 18,
    },
    refreshBoundDelay: 1000,
    devToolsFont: {
      family:
        'consolas, operator mono, Cascadia Code, OperatorMonoSSmLig Nerd Font, "Agave Nerd Font", "Cascadia Code PL", monospace',
      size: "13px",
    },
    ignoreProtocols: ["http", "https", APP_PROTOCOL, "file", "code", "cursor", "app"] as const,
    vibrancy: {
      macOS: {
        type: "sidebar" as const,
        state: "followWindow" as const,
      },
    },
    windowPreferences: {
      preloadScript: path.join(__dirname, "../preload/index.cjs"),
    },
  } as const

  readonly windowStateStoreKey = this.config.windowStateStoreKey

  private windows = {
    mainWindow: null as BrowserWindow | null,
  }

  private bindEvents(window: BrowserWindow) {
    window.on("leave-html-full-screen", () => {
      // To solve the vibrancy losing issue when leaving full screen mode
      // @see https://github.com/toeverything/AFFiNE/blob/280e24934a27557529479a70ab38c4f5fc65cb00/packages/frontend/electron/src/main/windows-manager/main-window.ts:L157
      refreshBound(window)
      refreshBound(window, this.config.refreshBoundDelay)
    })

    const parseProtocol = (url: string) => {
      try {
        return new URL(url).protocol.slice(0, -1)
      } catch {
        logger.warn("Blocked external URL with invalid format", { url })
        return null
      }
    }

    const isIgnoredProtocol = (
      protocol: string,
    ): protocol is (typeof this.config.ignoreProtocols)[number] => {
      return this.config.ignoreProtocols.includes(
        protocol as (typeof this.config.ignoreProtocols)[number],
      )
    }

    const isWebProtocol = (protocol: string) => protocol === "http" || protocol === "https"

    window.webContents.setWindowOpenHandler((details) => {
      const protocol = parseProtocol(details.url)
      if (protocol && !isWebProtocol(protocol) && isIgnoredProtocol(protocol)) {
        logger.warn("Blocked window.open for ignored protocol", {
          protocol,
          url: details.url,
        })
        return { action: "deny" }
      }

      void openExternalSafely(details.url)
      return { action: "deny" }
    })

    // A page served by the app protocol is the app's, and a file may be of a network share
    const isLocalProtocol = (protocol: string) => protocol === "app" || protocol === "file"

    const handleWebviewNavigation = (e: Event, url: string) => {
      const protocol = parseProtocol(url)
      if (!protocol) {
        e.preventDefault()
        return
      }
      if (isLocalProtocol(protocol)) {
        logger.warn("Blocked webview navigation to a local page", { url })
        e.preventDefault()
        return
      }

      if (isIgnoredProtocol(protocol)) {
        return
      }
      e.preventDefault()

      void openExternalSafely(url)
    }

    // The window only shows the app's own pages. Any other page would get the app's preload
    // script, so web pages open in the browser instead.
    const handleMainFrameNavigation = (e: Event, url: string) => {
      const protocol = parseProtocol(url)
      if (!protocol) {
        e.preventDefault()
        return
      }
      // E.g. a reload
      if (isAppPage(url)) return

      if (isLocalProtocol(protocol)) {
        logger.warn("Blocked navigation to a local page", { url })
        e.preventDefault()
        return
      }
      // Chromium hands deep links and editor links to the system, and the page stays
      if (!isWebProtocol(protocol) && isIgnoredProtocol(protocol)) return

      e.preventDefault()
      void openExternalSafely(url)
    }

    window.webContents.on("will-navigate", handleMainFrameNavigation)

    // A webview shows pages of the web: none of the app's scripts in them, none of the powers
    // the attributes of the element could ask for, and none of the app page's storage
    window.webContents.on("will-attach-webview", (_, webPreferences) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.webSecurity = true
      webPreferences.sandbox = true
      webPreferences.partition = WEBVIEW_PARTITION
    })

    window.webContents.on("did-attach-webview", (_, webContents) => {
      webContents.on("will-navigate", handleWebviewNavigation)
    })

    if (isWindows) {
      // Change the default font-family and font-size of the devtools.
      // Make it consistent with Chrome on Windows, instead of SimSun.
      // ref: [[Feature Request]: Add possibility to change DevTools font · Issue #42055 · electron/electron](https://github.com/electron/electron/issues/42055)
      window.webContents.on("devtools-opened", () => {
        this.setupDevToolsFont(window)
      })
    }

    this.bindWindowStateEvents(window)
  }

  private setupDevToolsFont(window: BrowserWindow) {
    // source-code-font: For code such as Elements panel
    // monospace-font: For sidebar such as Event Listener Panel
    const css = `:root {--devtool-font-family: ${this.config.devToolsFont.family};--source-code-font-family:var(--devtool-font-family);--source-code-font-size: ${this.config.devToolsFont.size};--monospace-font-family: var(--devtool-font-family);--monospace-font-size: ${this.config.devToolsFont.size};}`
    const js = `
      const overriddenStyle = document.createElement('style');
      overriddenStyle.innerHTML = '${css.replaceAll("\n", " ")}';
      document.body.append(overriddenStyle);
      document.querySelectorAll('.platform-windows').forEach(el => el.classList.remove('platform-windows'));
      addStyleToAutoComplete();
      const observer = new MutationObserver((mutationList, observer) => {
          for (const mutation of mutationList) {
              if (mutation.type === 'childList') {
                  for (let i = 0; i < mutation.addedNodes.length; i++) {
                      const item = mutation.addedNodes[i];
                      if (item instanceof HTMLElement && item.classList.contains('editor-tooltip-host')) {
                          addStyleToAutoComplete();
                      }
                  }
              }
          }
      });
      observer.observe(document.body, {childList: true});
      function addStyleToAutoComplete() {
          document.querySelectorAll('.editor-tooltip-host').forEach(element => {
              if (element.shadowRoot && element.shadowRoot.querySelectorAll('[data-key="overridden-dev-tools-font"]').length === 0) {
                  const overriddenStyle = document.createElement('style');
                  overriddenStyle.setAttribute('data-key', 'overridden-dev-tools-font');
                  overriddenStyle.innerHTML = '.cm-tooltip-autocomplete ul[role=listbox] {font-family: consolas !important;}';
                  element.shadowRoot.append(overriddenStyle);
              }
          });
      }
    `
    window.webContents.devToolsWebContents?.executeJavaScript(js)
  }

  private bindWindowStateEvents(window: BrowserWindow) {
    // async render and main state
    window.on("maximize", async () => {
      const caller = callWindowExpose(window)
      await caller.setWindowState(WindowState.MAXIMIZED)
    })

    window.on("unmaximize", async () => {
      const caller = callWindowExpose(window)
      await caller.setWindowState(WindowState.NORMAL)
    })

    window.on("minimize", async () => {
      const caller = callWindowExpose(window)
      await caller.setWindowState(WindowState.MINIMIZED)
    })

    window.on("restore", async () => {
      const caller = callWindowExpose(window)
      await caller.setWindowState(WindowState.NORMAL)
    })
  }

  /**
   * Remember where the window is. A maximized window keeps the size it returns to, along with
   * the fact that it was maximized.
   */
  saveMainWindowState = (window: BrowserWindow) => {
    const isMaximized = window.isMaximized()
    const bounds = isMaximized ? window.getNormalBounds() : window.getBounds()
    store.set(this.windowStateStoreKey, {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized,
    })
  }

  private bindMainWindowCloseHandlers(window: BrowserWindow) {
    window.on("close", () => {
      this.saveMainWindowState(window)
    })

    window.on("close", (event) => {
      const minimizeToTray = getTrayConfig()
      if (isMacOS || minimizeToTray) {
        event.preventDefault()
        if (window.isFullScreen()) {
          window.once("leave-full-screen", () => {
            window.hide()
          })
          window.setFullScreen(false)
        } else {
          window.hide()
        }

        const caller = callWindowExpose(window)
        caller.onWindowClose()
      } else {
        this.windows.mainWindow = null
      }
    })

    // Brought back from the Dock, the tray or another launch. The renderer refreshes what went
    // stale while the window was hidden for long, measured from the close above.
    window.on("show", () => {
      callWindowExpose(window).onWindowShow()
    })
  }

  private getPlatformSpecificWindowConfig(): Partial<BrowserWindowConstructorOptions> {
    const { platform } = process

    switch (platform) {
      case "darwin": {
        return {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: {
            x: this.config.macOSTrafficLight.x,
            y: this.config.macOSTrafficLight.y,
          },
          vibrancy: this.config.vibrancy.macOS.type,
          visualEffectState: this.config.vibrancy.macOS.state,
          transparent: true,
        }
      }

      case "win32": {
        return {
          icon: getIconPath(),
          titleBarStyle: "hidden",
          // Electron material bug, comment this for now
          // backgroundMaterial: isWindows11 ? "mica" : undefined,
          frame: true,
        }
      }

      default: {
        return {
          icon: getIconPath(),
        }
      }
    }
  }

  createWindow = (
    options: {
      extraPath?: string
      height: number
      width: number
    } & BrowserWindowConstructorOptions,
  ) => {
    const { extraPath, height, width, ...configs } = options
    const server = getServerUrl()

    const baseWindowConfig: Electron.BrowserWindowConstructorOptions = {
      width,
      height,
      show: false,
      resizable: configs?.resizable ?? true,
      autoHideMenuBar: true,
      alwaysOnTop: false,
      // The page shows HTML from feeds: it runs without Node and apart from the preload
      // script, which hands it the few things of Electron it needs
      webPreferences: {
        preload: this.config.windowPreferences.preloadScript,
        sandbox: true,
        webviewTag: true,
        nodeIntegration: false,
        contextIsolation: true,
        additionalArguments: server ? [`${SERVER_URL_ARG}${server}`] : [],
      },
      ...this.getPlatformSpecificWindowConfig(),
    }

    // Create the browser window.
    const window = new BrowserWindow({
      ...baseWindowConfig,
      ...configs,
    })

    this.bindEvents(window)

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    const devServerUrl = getDevServerUrl()
    if (devServerUrl) {
      window.loadURL(devServerUrl + (options?.extraPath || ""))
      logger.log(devServerUrl + (options?.extraPath || ""))
    } else {
      const appLoadEntry = `${APP_ORIGIN}/index.html${options?.extraPath || ""}`

      window.loadURL(appLoadEntry)
      logger.log("load URL", appLoadEntry)
    }

    return window
  }

  private ensureWindowBoundsInScreen(windowState?: {
    width?: number
    height?: number
    x?: number
    y?: number
  }) {
    // The display the window was on, as long as it is still connected, rather than always the
    // primary one
    const savedX = windowState?.x
    const savedY = windowState?.y
    const display =
      savedX !== undefined && savedY !== undefined
        ? screen.getDisplayMatching({
            x: savedX,
            y: savedY,
            width: windowState?.width ?? WindowManagerStatic.mainWindowDefaultSize.width,
            height: windowState?.height ?? WindowManagerStatic.mainWindowDefaultSize.height,
          })
        : screen.getPrimaryDisplay()
    const { workArea } = display

    const maxWidth = workArea.width
    const maxHeight = workArea.height

    const defaultSize = WindowManagerStatic.mainWindowDefaultSize

    const width = windowState?.width ? Math.min(windowState.width, maxWidth) : defaultSize.width
    const height = windowState?.height
      ? Math.min(windowState.height, maxHeight)
      : defaultSize.height

    const ensureInBounds = (value: number, min: number, max: number): number => {
      return Math.max(min, Math.min(value, max))
    }

    const x =
      windowState?.x !== undefined
        ? ensureInBounds(windowState.x, workArea.x, workArea.x + workArea.width - width)
        : undefined

    const y =
      windowState?.y !== undefined
        ? ensureInBounds(windowState.y, workArea.y, workArea.y + workArea.height - height)
        : undefined

    return { width, height, x, y, maxWidth, maxHeight }
  }

  createMainWindow = () => {
    const windowState = store.get(this.windowStateStoreKey) as
      | {
          width?: number
          height?: number
          x?: number
          y?: number
          isMaximized?: boolean
        }
      | undefined
    const { width, height, x, y, maxWidth, maxHeight } =
      this.ensureWindowBoundsInScreen(windowState)

    const window = this.createWindow({
      width,
      height,
      x,
      y,
      minWidth: Math.min(this.config.minWindowSize.width, maxWidth),
      minHeight: Math.min(this.config.minWindowSize.height, maxHeight),
    })

    // Once shown: maximizing a hidden window shows it before the renderer is ready. macOS
    // ignores a maximize while the window is still being ordered in, so it waits a tick.
    // Maximizing a hidden window would show it before the renderer is ready, so it happens when
    // the window is first shown
    if (windowState?.isMaximized) {
      this.maximizeOnFirstShow.add(window)
    }

    this.bindMainWindowCloseHandlers(window)
    // Deep links wait while the renderer loads, until it reports that it is ready again
    window.webContents.on("did-navigate", () => setRendererReady(false))
    window.on("closed", () => setRendererReady(false))

    this.windows.mainWindow = window

    return window
  }

  showSetting = (path?: string) => {
    // We need to open the setting modal in the main window when the main window exists,
    // if we open a new window then the state between the two windows will be out of sync.
    if (this.windows.mainWindow) {
      this.showMainWindow(this.windows.mainWindow)

      callWindowExpose(this.windows.mainWindow).showSetting(path)
      return
    } else {
      this.windows.mainWindow = this.createMainWindow()
      this.showMainWindow(this.windows.mainWindow)
      callWindowExpose(this.windows.mainWindow).showSetting(path)
    }
  }

  getMainWindow = () => this.windows.mainWindow

  private maximizeOnFirstShow = new WeakSet<BrowserWindow>()

  /**
   * Brings the main window back, whether hidden or minimized, maximized the first time if it was
   * maximized when the app quit.
   */
  showMainWindow = (window = this.windows.mainWindow) => {
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    if (this.maximizeOnFirstShow.delete(window)) window.maximize()
  }

  getMainWindowOrCreate = () => {
    if (!this.windows.mainWindow) {
      return this.createMainWindow()
    }
    return this.windows.mainWindow
  }

  destroyMainWindow = () => {
    this.windows.mainWindow?.destroy()
    this.windows.mainWindow = null
  }
}

export const WindowManager = new WindowManagerStatic()
