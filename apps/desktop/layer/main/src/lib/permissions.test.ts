import { describe, expect, it, vi } from "vitest"

import { isPermissionGranted } from "./permissions"

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

const APP_PAGE = "app://yanrr/index.html"

describe("isPermissionGranted", () => {
  it.each(["clipboard-sanitized-write", "clipboard-read", "openExternal", "fullscreen"])(
    "lets the app's own page use %s",
    (permission) => {
      expect(isPermissionGranted(permission, APP_PAGE)).toBe(true)
    },
  )

  it.each(["media", "geolocation", "notifications", "midi", "unknown"])(
    "refuses the app's own page %s, which it does not use",
    (permission) => {
      expect(isPermissionGranted(permission, APP_PAGE)).toBe(false)
    },
  )

  it.each(["media", "geolocation", "clipboard-read", "notifications", "openExternal"])(
    "refuses a web page %s",
    (permission) => {
      expect(isPermissionGranted(permission, "https://example.com/article")).toBe(false)
    },
  )

  it("lets a web page go full screen, as a video in a webview does", () => {
    expect(isPermissionGranted("fullscreen", "https://www.youtube.com/embed/1")).toBe(true)
  })
})
