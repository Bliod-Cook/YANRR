import { WEBVIEW_BRIDGE_VERSION } from "@follow/shared/webview-bridge"
import { describe, expect, it } from "vitest"

import { assertBridgeVersion } from "./bridge-version"

describe("assertBridgeVersion", () => {
  it("accepts the app's version", () => {
    expect(() => assertBridgeVersion(WEBVIEW_BRIDGE_VERSION)).not.toThrow()
  })

  it("names both versions when they differ, and rejects a page without one", () => {
    expect(() => assertBridgeVersion(WEBVIEW_BRIDGE_VERSION + 1)).toThrow(
      `bridge version ${WEBVIEW_BRIDGE_VERSION + 1}, the app ${WEBVIEW_BRIDGE_VERSION}`,
    )
    expect(() => assertBridgeVersion(null)).toThrow("bridge version null")
    expect(() => assertBridgeVersion(undefined)).toThrow("bridge version undefined")
  })
})
