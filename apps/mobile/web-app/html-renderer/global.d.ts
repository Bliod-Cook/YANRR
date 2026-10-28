import "vite/client"
import "../../../../packages/types/react-global"
import "../../../../packages/types/global"

interface Bridge {
  measure: () => void
  setContentHeight: (height: number) => void
  previewImage: (data: { imageUrls: string[]; index: number }) => void
  seekAudio: (time: number) => void
}

declare global {
  export const bridge: Bridge

  interface Window {
    /** Android only: the WebView's own interface to the app */
    ReactNativeWebView?: { postMessage: (message: string) => void }
  }
}

export {}
