import { describe, expect, it, vi } from "vitest"

import { SettingService } from "./setting"

const setLoginItemSettings = vi.hoisted(() => vi.fn())

vi.mock("electron", () => ({ app: { setLoginItemSettings }, nativeTheme: {} }))
vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))
vi.mock("~/manager/window", () => ({ WindowManager: {} }))
vi.mock("../../lib/proxy", () => ({}))
vi.mock("../../lib/store", () => ({ store: {} }))
vi.mock("../../lib/tray", () => ({}))

describe("SettingService.setOpenAtLogin", () => {
  it("registers the app itself, started in the tray, and nothing a page could name", () => {
    new SettingService().setOpenAtLogin(true)

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ["--start-in-tray"],
    })
  })
})
