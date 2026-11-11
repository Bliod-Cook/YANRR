import "vite/client"
import "../../../../packages/types/react-global"
import "../../../../packages/types/global"

import type { PageToAppPayloads } from "@follow/shared/webview-bridge"

/** Injected by the app around its message channel */
interface Bridge {
  previewImage: (data: PageToAppPayloads["previewImage"]) => void
  seekAudio: (time: PageToAppPayloads["audio:seekTo"]["time"]) => void
}

declare global {
  export const bridge: Bridge

  interface Window {
    /** Android: the WebView's own channel to the app */
    ReactNativeWebView?: { postMessage: (message: string) => void }
    /** iOS: the app's message handler */
    webkit?: { messageHandlers: { message: { postMessage: (message: string) => void } } }
  }
}

export {}
