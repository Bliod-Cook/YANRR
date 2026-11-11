import fsp from "node:fs/promises"
import os from "node:os"

import path from "pathe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SettingService } from "./setting"

const mocks = vi.hoisted(() => ({
  getLoginItemSettings: vi.fn(),
  setLoginItemSettings: vi.fn(),
  storeGet: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getLoginItemSettings: mocks.getLoginItemSettings,
    setLoginItemSettings: mocks.setLoginItemSettings,
  },
  nativeTheme: {},
}))
vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))
vi.mock("../../lib/proxy", () => ({}))
vi.mock("../../lib/store", () => ({ store: { get: mocks.storeGet } }))
vi.mock("../../lib/tray", () => ({}))

describe("SettingService login item", () => {
  const execPath = process.execPath
  let installDir: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    process.execPath = execPath
    if (installDir) await fsp.rm(installDir, { force: true, recursive: true })
    installDir = undefined
  })

  it("registers the app itself, started in the tray, and nothing a page could name", () => {
    new SettingService().setOpenAtLogin(true)

    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: process.execPath,
      args: ["--start-in-tray"],
    })
  })

  it("registers the launcher of a Squirrel install, which starts whichever version is installed", async () => {
    // A Squirrel install: `Update.exe` and the launcher next to one folder per version
    installDir = await fsp.mkdtemp(path.join(os.tmpdir(), "yanrr-squirrel-"))
    await fsp.mkdir(path.join(installDir, "app-0.1.9"))
    await fsp.writeFile(path.join(installDir, "Update.exe"), "")
    process.execPath = path.join(installDir, "app-0.1.9", "Yanrr.exe")
    const service = new SettingService()

    service.setOpenAtLogin(true)
    service.getLoginItemSettings()

    const loginItem = { path: path.join(installDir, "Yanrr.exe"), args: ["--start-in-tray"] }
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, ...loginItem })
    // Windows tells whether the app starts at login only when asked about the same command
    expect(mocks.getLoginItemSettings).toHaveBeenCalledWith(loginItem)
  })
})

describe("SettingService.getMessagingToken", () => {
  it("hands out the push token alone, not the keys it came with", () => {
    mocks.storeGet.mockImplementation((key: string) =>
      key === "notifications-credentials"
        ? { fcm: { token: "fcm-token" }, keys: { privateKey: "private-key" } }
        : undefined,
    )

    expect(new SettingService().getMessagingToken()).toBe("fcm-token")
  })

  it("has none before the push service registered the device", () => {
    mocks.storeGet.mockReturnValue(undefined)

    expect(new SettingService().getMessagingToken()).toBeNull()
  })
})
