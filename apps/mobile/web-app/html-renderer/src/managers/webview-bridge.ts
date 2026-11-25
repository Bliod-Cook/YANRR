import type { ReaderStylePayload } from "@follow/shared/settings/reader-style"
import type {
  AppToPagePayloads,
  AppToPageType,
  PageToAppMessage,
} from "@follow/shared/webview-bridge"
import { WEBVIEW_BRIDGE_VERSION } from "@follow/shared/webview-bridge"

import type { EntryModel, SpotlightState } from "../../types"
import {
  codeThemeDarkAtom,
  codeThemeLightAtom,
  entryAtom,
  imageProxyAtom,
  noMediaAtom,
  readerRenderInlineStyleAtom,
  readerStyleAtom,
  spotlightAtom,
} from "../atoms"

type Store = ReturnType<typeof import("jotai").createStore>

type Handlers = { [K in AppToPageType]: (payload: AppToPagePayloads[K]) => void }

// The injected `bridge` may not exist yet on Android, while the platform's own channel always does
const postToApp = (message: PageToAppMessage) => {
  const json = JSON.stringify(message)
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(json)
  } else {
    window.webkit?.messageHandlers.message.postMessage(json)
  }
}

/**
 * WebView Bridge Manager
 * Handles all JavaScript bridge functions exposed to the native WebView
 */
export class WebViewBridgeManager {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  /**
   * Set the current entry to be rendered
   */
  setEntry = (entry: AppToPagePayloads["setEntry"]) => {
    this.store.set(entryAtom, entry as EntryModel)
    if (Array.isArray(entry.spotlightRules)) {
      this.store.set(spotlightAtom, entry.spotlightRules)
    }
  }

  setSpotlights = (spotlights: SpotlightState["spotlights"]) => {
    this.store.set(spotlightAtom, spotlights)
  }

  /**
   * Set code highlighting themes for light and dark modes
   */
  setCodeTheme = (v: { light: string; dark: string }) => {
    this.store.set(codeThemeLightAtom, v.light)
    this.store.set(codeThemeDarkAtom, v.dark)
  }

  /**
   * Set reader render inline style preference
   */
  setReaderRenderInlineStyle = (value: boolean) => {
    this.store.set(readerRenderInlineStyleAtom, value)
  }

  /**
   * Toggle media display
   */
  setNoMedia = (value: boolean) => {
    this.store.set(noMediaAtom, value)
  }

  /**
   * Set reader typography: font family, line height and text color
   */
  setReaderStyle = (value: ReaderStylePayload) => {
    this.store.set(readerStyleAtom, value)
  }

  /**
   * Set where images load from: through the image proxy or from their hosts
   */
  setImageProxy = (value: AppToPagePayloads["setImageProxy"]) => {
    this.store.set(imageProxyAtom, value)
  }

  /**
   * Set root font size for the WebView
   */
  setRootFontSize = (size: number) => {
    document.documentElement.style.fontSize = `${size}px`
  }

  /**
   * Expose all methods to the global window object
   * This maintains backward compatibility with existing native code
   */
  exposeToWindow() {
    // Minimal native->JS dispatch bridge to centralize API surface
    if (!window.__FO_BRIDGE__) {
      const handlers: Handlers = {
        setEntry: this.setEntry,
        setSpotlights: this.setSpotlights,
        setCodeTheme: this.setCodeTheme,
        setReaderRenderInlineStyle: this.setReaderRenderInlineStyle,
        setNoMedia: this.setNoMedia,
        setReaderStyle: this.setReaderStyle,
        setRootFontSize: this.setRootFontSize,
        setImageProxy: this.setImageProxy,
      }

      const handle = (type: string, payload: unknown) => {
        const handler = handlers[type as AppToPageType] as ((payload: unknown) => void) | undefined
        if (handler) {
          handler(payload)
        } else {
          console.warn("[FO_BRIDGE] No handler for", type)
        }
      }

      window.__FO_BRIDGE__ = {
        // The app parses its JSON before it calls in
        dispatch(type, payload) {
          try {
            handle(type, payload)
          } catch (e) {
            console.error("[FO_BRIDGE] dispatch error", type, e)
          }
        },
        applyState(state) {
          try {
            for (const [type, payload] of Object.entries(state)) {
              // No payload is a string: iOS replays a boolean or a number as its JSON text
              handle(type, typeof payload === "string" ? JSON.parse(payload) : payload)
            }
          } catch (e) {
            console.error("[FO_BRIDGE] applyState error", e)
          }
        },
      }
      postToApp({ type: "bridgeReady", payload: { version: WEBVIEW_BRIDGE_VERSION } })
    }
  }
}

declare global {
  interface Window {
    __FO_BRIDGE__: {
      dispatch: <T extends AppToPageType>(type: T, payload: AppToPagePayloads[T]) => void
      applyState: (state: Partial<Record<AppToPageType, unknown>>) => void
    }
  }
}
