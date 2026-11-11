/**
 * The messages the entry renderer page (`apps/mobile/web-app/html-renderer`) and the mobile app
 * exchange. The Swift module (`apps/mobile/native/ios/Modules/SharedWebView`) and the scripts
 * injected on Android (`apps/mobile/src/components/native/webview/injected-js.ts`) keep their own
 * copies of these names and payloads: change them together, and bump the version.
 */
import type { ReaderStylePayload } from "./settings/reader-style"
import type { SpotlightRule } from "./spotlight"

/** Bumped on any change to the messages below or to the page's `__FO_BRIDGE__` handlers */
export const WEBVIEW_BRIDGE_VERSION = 2

/** App to page: `__FO_BRIDGE__.dispatch(type, JSON.stringify(payload))` */
export interface AppToPagePayloads {
  /** The entry fields are typed by the caller, as the page's entry model lives with the store */
  setEntry: Record<string, unknown> & { spotlightRules?: SpotlightRule[] }
  setSpotlights: SpotlightRule[]
  setCodeTheme: { light: string; dark: string }
  setReaderRenderInlineStyle: boolean
  setNoMedia: boolean
  setReaderStyle: ReaderStylePayload
  setRootFontSize: number
}

export type AppToPageType = keyof AppToPagePayloads

/** Page to app: `JSON.stringify({ type, payload })` through the platform's message channel */
export interface PageToAppPayloads {
  bridgeReady: { version: number }
  setContentHeight: number
  previewImage: { imageUrls: string[]; index: number }
  "audio:seekTo": { time: number }
}

export type PageToAppMessage = {
  [K in keyof PageToAppPayloads]: { type: K; payload: PageToAppPayloads[K] }
}[keyof PageToAppPayloads]
