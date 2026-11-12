import { EventEmitter } from "node:events"

import type { BrowserWindow } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  onWindowClose: vi.fn(),
  onWindowShow: vi.fn(),
  openExternalSafely: vi.fn(),
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))
vi.mock("@follow/shared/bridge", () => ({
  callWindowExpose: () => ({
    onWindowClose: mocks.onWindowClose,
    onWindowShow: mocks.onWindowShow,
  }),
  WindowState: {},
}))
vi.mock("@follow/shared/constants", () => ({ APP_PROTOCOL: "yanrr" }))
vi.mock("electron", () => ({
  BrowserWindow: class {},
  screen: {},
}))
vi.mock("~/env", () => ({ isMacOS: true, isWindows: false }))
vi.mock("~/helper", () => ({ getIconPath: vi.fn() }))
vi.mock("~/lib/deep-link", () => ({ setRendererReady: vi.fn() }))
vi.mock("~/lib/open-external", () => ({ openExternalSafely: mocks.openExternalSafely }))
vi.mock("~/lib/store", () => ({ store: { get: vi.fn(), set: vi.fn() } }))
vi.mock("~/lib/tray", () => ({ getTrayConfig: () => false }))
vi.mock("~/lib/utils", () => ({ refreshBound: vi.fn() }))
vi.mock("~/logger", () => ({ logger: { info: vi.fn(), log: vi.fn(), warn: vi.fn() } }))

const { WindowManager } = await import("./window")

class FakeWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
  hide = vi.fn()
  show = vi.fn()
  restore = vi.fn()
  minimized = false
  isDestroyed = () => false
  isFullScreen = () => false
  isMaximized = () => false
  isMinimized = () => this.minimized
  getBounds = () => ({ height: 700, width: 1000, x: 0, y: 0 })
}

const bindMainWindowCloseHandlers = (window: FakeWindow) => {
  const bind = Reflect.get(WindowManager, "bindMainWindowCloseHandlers") as (
    window: BrowserWindow,
  ) => void
  bind.call(WindowManager, window as unknown as BrowserWindow)
}

describe("main window visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("tells the renderer when the window it hid on close is shown again", () => {
    const window = new FakeWindow()
    bindMainWindowCloseHandlers(window)

    window.emit("close", { preventDefault: vi.fn() })
    expect(window.hide).toHaveBeenCalledTimes(1)
    expect(mocks.onWindowClose).toHaveBeenCalledTimes(1)
    expect(mocks.onWindowShow).not.toHaveBeenCalled()

    window.emit("show")
    expect(mocks.onWindowShow).toHaveBeenCalledTimes(1)
  })

  it("brings back a window that is minimized as well as one that is hidden", () => {
    const window = new FakeWindow()
    window.minimized = true

    WindowManager.showMainWindow(window as unknown as BrowserWindow)

    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
  })
})

const bindEvents = (window: FakeWindow) => {
  const bind = Reflect.get(WindowManager, "bindEvents") as (window: BrowserWindow) => void
  bind.call(WindowManager, window as unknown as BrowserWindow)
}

describe("webviews of the main window", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("get no script of the app's, none of the powers their attributes ask for and a session of their own", () => {
    const window = new FakeWindow()
    bindEvents(window)
    const webPreferences = {
      preload: "/tmp/planted.js",
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      webSecurity: false,
      sandbox: false,
      partition: "",
      zoomFactor: 1,
    }

    window.webContents.emit("will-attach-webview", {}, webPreferences)

    expect(webPreferences).toEqual({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      partition: "persist:webview",
      zoomFactor: 1,
    })
  })

  const navigateWebview = (url: string) => {
    const window = new FakeWindow()
    bindEvents(window)
    const webview = new EventEmitter()
    window.webContents.emit("did-attach-webview", {}, webview)

    const event = { preventDefault: vi.fn() }
    webview.emit("will-navigate", event, url)
    return event
  }

  it("keep pages of the web where they are", () => {
    const event = navigateWebview("https://example.com/article")

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mocks.openExternalSafely).not.toHaveBeenCalled()
  })

  it.each([
    ["the app's page", "app://yanrr/index.html"],
    ["a local file", "file:///C:/Users/me/notes.html"],
    ["a file of a share", "file://attacker.example/share/page.html"],
  ])("may not show %s", (_, url) => {
    const event = navigateWebview(url)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(mocks.openExternalSafely).not.toHaveBeenCalled()
  })
})

describe("main window navigation", () => {
  const navigate = (url: string) => {
    const window = new FakeWindow()
    bindEvents(window)

    const event = { preventDefault: vi.fn() }
    window.webContents.emit("will-navigate", event, url)
    return event
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps the app's own pages, e.g. on a reload", () => {
    const event = navigate("app://yanrr/index.html#/timeline")

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mocks.openExternalSafely).not.toHaveBeenCalled()
  })

  it.each([["https://example.com/nav-test"], ["obsidian://open?vault=Notes"]])(
    "opens %s outside the window, the one way the app opens links",
    (url) => {
      const event = navigate(url)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(mocks.openExternalSafely).toHaveBeenCalledWith(url)
    },
  )

  it("blocks other local pages", () => {
    for (const url of ["app://other.host/tmp/page.html", "file:///tmp/page.html", "not a url"]) {
      const event = navigate(url)
      expect(event.preventDefault).toHaveBeenCalled()
    }
    expect(mocks.openExternalSafely).not.toHaveBeenCalled()
  })

  it("leaves the app's deep links to the system", () => {
    const event = navigate("yanrr://feed?id=1")

    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
