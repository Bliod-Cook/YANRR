import type { ReaderStylePayload } from "@follow/shared/settings/reader-style"
import type { SpotlightRule } from "@follow/shared/spotlight"
import type { AppToPagePayloads, AppToPageType } from "@follow/shared/webview-bridge"
import type { EntryModel } from "@follow/store/entry/types"

import { SharedWebViewModule } from "./index"

/** What the page renders of an entry */
export type WebViewEntry = Pick<EntryModel, "content" | "url" | "media" | "attachments"> & {
  spotlightRules?: SpotlightRule[]
  /** The feed's site, the base for relative addresses when the entry has no URL */
  siteUrl?: string | null
}

const dispatch = <T extends AppToPageType>(type: T, payload: AppToPagePayloads[T]) => {
  SharedWebViewModule.dispatch?.(type, JSON.stringify(payload))
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
    dispatch("setCodeTheme", { light, dark })
  },

  /**
   * Set the current entry data in WebView. Takes a whole entry too, of which it sends only what
   * the page renders.
   */
  setEntry(entry?: WebViewEntry | null): void {
    if (!entry) return
    const { content, url, media, attachments, spotlightRules, siteUrl } = entry
    const payload: WebViewEntry = { content, url, media, attachments, spotlightRules, siteUrl }
    dispatch("setEntry", payload)
  },

  /**
   * Set spotlight rules for rich content highlighting in WebView
   */
  setSpotlights(spotlights: SpotlightRule[]): void {
    dispatch("setSpotlights", spotlights)
  },

  /**
   * Set root font size for the WebView
   */
  setRootFontSize(size = 16): void {
    dispatch("setRootFontSize", size)
  },

  /**
   * Toggle media display in WebView
   */
  setNoMedia(value: boolean): void {
    dispatch("setNoMedia", value)
  },

  /**
   * Set where the page loads images from: through the image proxy or from their hosts
   */
  setImageProxy(value: AppToPagePayloads["setImageProxy"]): void {
    dispatch("setImageProxy", value)
  },

  /**
   * Set reader render inline style preference
   */
  setReaderRenderInlineStyle(value: boolean): void {
    dispatch("setReaderRenderInlineStyle", value)
  },

  /**
   * Set reader typography (font family, line height and text color)
   */
  setReaderStyle(style: ReaderStylePayload): void {
    dispatch("setReaderStyle", style)
  },

  /**
   * Load a URL in the WebView
   */
  loadUrl(url: string): void {
    SharedWebViewModule.load(url)
  },
}
