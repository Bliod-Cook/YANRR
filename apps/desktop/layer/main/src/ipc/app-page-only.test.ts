import { ipcMain } from "electron"
import { describe, expect, it, vi } from "vitest"

import { registerForAppPageOnly } from "./app-page-only"

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    },
  },
}))
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

registerForAppPageOnly(() => ipcMain.handle("echo.say", (_event, word: string) => word))

const invokeFrom = (origin: string | null) =>
  handlers.get("echo.say")!({ senderFrame: origin === null ? null : { origin } }, "hi")

describe("registerForAppPageOnly", () => {
  it("answers the app's own pages", () => {
    expect(invokeFrom("app://yanrr")).toBe("hi")
  })

  it.each([
    ["a web page, e.g. in a webview", "https://example.com"],
    ["a page of another host of the app protocol", "app://example.com"],
    ["a page without an origin, like the find bar's", "null"],
    ["a local file", "file://"],
    ["a frame that is gone", null],
  ])("refuses %s", (_, origin) => {
    expect(() => invokeFrom(origin)).toThrow("echo.say")
  })

  it("leaves handlers registered afterwards alone", () => {
    ipcMain.handle("later", () => "answered")

    expect(handlers.get("later")!({ senderFrame: null })).toBe("answered")
  })
})
