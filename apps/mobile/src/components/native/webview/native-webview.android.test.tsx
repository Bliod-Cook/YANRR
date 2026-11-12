// @vitest-environment happy-dom
import { runInNewContext } from "node:vm"

import { WEBVIEW_BRIDGE_VERSION } from "@follow/shared/webview-bridge"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { WebViewMessageEvent, WebViewProps } from "react-native-webview"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { dispatchToPage, NativeWebView } from "./native-webview.android"

const mocks = vi.hoisted(() => ({
  injectJavaScript: vi.fn<(script: string) => void>(),
  onMessage: undefined as WebViewProps["onMessage"],
}))

vi.mock("@follow/utils", async () => ({
  jotaiStore: (await import("jotai")).createStore(),
}))
vi.mock("@/src/lib/native", () => ({ openLink: vi.fn() }))
vi.mock("./constants", () => ({ htmlUrl: "file:///android_asset/html-renderer/index.html" }))
vi.mock("react-native-reanimated", () => ({}))
vi.mock("react-native-webview", async () => {
  const { useImperativeHandle } = await import("react")
  return {
    default: function MockWebView(props: {
      ref: React.Ref<{ injectJavaScript: typeof mocks.injectJavaScript }>
      onMessage?: WebViewProps["onMessage"]
    }) {
      mocks.onMessage = props.onMessage
      useImperativeHandle(props.ref, () => ({ injectJavaScript: mocks.injectJavaScript }))
      return null
    },
  }
})

beforeEach(() => {
  vi.stubGlobal("React", React)
  vi.stubGlobal("__DEV__", false)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mocks.injectJavaScript.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

test.each(["null", "file:///android_asset/html-renderer/index.html"])(
  "delivers queued article content after a local page handshake from %s",
  async (url) => {
    const root = createRoot(document.createElement("div"))
    const entry = { content: "<p>Article body</p>" }
    try {
      await act(() => root.render(<NativeWebView />))
      dispatchToPage("setEntry", JSON.stringify(entry))
      expect(mocks.injectJavaScript).not.toHaveBeenCalled()

      const data = JSON.stringify({
        type: "bridgeReady",
        payload: { version: WEBVIEW_BRIDGE_VERSION },
      })
      mocks.onMessage?.({ nativeEvent: { url, data } } as WebViewMessageEvent)

      expect(mocks.injectJavaScript).toHaveBeenCalledOnce()
      const dispatch = vi.fn()
      runInNewContext(mocks.injectJavaScript.mock.calls[0]![0], {
        window: { __FO_BRIDGE__: { dispatch } },
      })
      expect(dispatch).toHaveBeenCalledWith("setEntry", entry)
    } finally {
      await act(() => root.unmount())
    }
  },
)

test("ignores handshakes from remote article frames", async () => {
  const root = createRoot(document.createElement("div"))
  try {
    await act(() => root.render(<NativeWebView />))
    dispatchToPage("setEntry", JSON.stringify({ content: "<p>Article body</p>" }))
    mocks.onMessage?.({
      nativeEvent: {
        url: "https://player.example.com",
        data: JSON.stringify({ type: "bridgeReady", payload: { version: WEBVIEW_BRIDGE_VERSION } }),
      },
    } as WebViewMessageEvent)
    expect(mocks.injectJavaScript).not.toHaveBeenCalled()
  } finally {
    await act(() => root.unmount())
  }
})
