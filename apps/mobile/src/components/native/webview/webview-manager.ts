import type { ReaderStylePayload } from "@follow/shared/settings/reader-style"
import type { SpotlightRule } from "@follow/shared/spotlight"
import type { EntryModel } from "@follow/store/entry/types"

import { SharedWebViewModule } from "./index"

/** What the page renders of an entry */
export type WebViewEntry = Pick<EntryModel, "content" | "url" | "media" | "attachments"> & {
  spotlightRules?: SpotlightRule[]
}

/**
 * WebView JavaScript bridge manager
 * Provides a centralized way to execute JavaScript functions in the WebView
 */
export const WebViewManager = {
  /**
   * Set code highlighting themes for light and dark modes
   */
  setCodeTheme(light: string, dark: string): void {
    SharedWebViewModule.dispatch?.("setCodeTheme", JSON.stringify({ light, dark }))
  },

  /**
   * Set the current entry data in WebView. Takes a whole entry too, of which it sends only what
   * the page renders.
   */
  setEntry(entry?: WebViewEntry | null): void {
    if (!entry) return
    const { content, url, media, attachments, spotlightRules } = entry
    const payload: WebViewEntry = { content, url, media, attachments, spotlightRules }
    SharedWebViewModule.dispatch?.("setEntry", JSON.stringify(payload))
  },

  /**
   * Set spotlight rules for rich content highlighting in WebView
   */
  setSpotlights(spotlights: SpotlightRule[]): void {
    SharedWebViewModule.dispatch?.("setSpotlights", JSON.stringify(spotlights))
  },

  /**
   * Set root font size for the WebView
   */
  setRootFontSize(size = 16): void {
    SharedWebViewModule.dispatch?.("setRootFontSize", JSON.stringify(size))
  },

  /**
   * Toggle media display in WebView
   */
  setNoMedia(value: boolean): void {
    SharedWebViewModule.dispatch?.("setNoMedia", JSON.stringify(value))
  },

  /**
   * Set reader render inline style preference
   */
  setReaderRenderInlineStyle(value: boolean): void {
    SharedWebViewModule.dispatch?.("setReaderRenderInlineStyle", JSON.stringify(value))
  },

  /**
   * Set reader typography (font family, line height and text color)
   */
  setReaderStyle(style: ReaderStylePayload): void {
    SharedWebViewModule.dispatch?.("setReaderStyle", JSON.stringify(style))
  },

  /**
   * Load a URL in the WebView
   */
  loadUrl(url: string): void {
    SharedWebViewModule.load(url)
  },
}
