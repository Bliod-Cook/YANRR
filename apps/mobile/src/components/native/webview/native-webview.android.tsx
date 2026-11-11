import { useTypeScriptHappyCallback } from "@follow/hooks/shared"
import type { PageToAppMessage } from "@follow/shared/webview-bridge"
import { jotaiStore } from "@follow/utils"
import { atom } from "jotai"
import type * as React from "react"
import type { ViewProps } from "react-native"
import { runOnJS, runOnUI } from "react-native-reanimated"
import type { WebViewMessageEvent, WebViewNavigation, WebViewProps } from "react-native-webview"
import WebView from "react-native-webview"

import { openLink } from "@/src/lib/native"

import { useLightboxControls } from "../../ui/lightbox/lightboxState"
import { createBridgeQueue } from "./bridge-queue"
import { assertBridgeVersion } from "./bridge-version"
import { htmlUrl } from "./constants"
import { atEnd, atStart } from "./injected-js"

type WebViewRef = WebView<WebViewProps>

const webviewAtom = atom<WebViewRef | null>(null)

const injectJavaScript = (js: string) => {
  const webview = jotaiStore.get(webviewAtom)
  if (!webview) {
    // The script can hold a whole article, which must not reach the device log
    console.warn("WebView not ready, injecting JavaScript failed")
    return
  }
  return webview.injectJavaScript(js)
}

const bridgeQueue = createBridgeQueue((type, payload) => {
  const payloadExpr = payload != null ? `JSON.parse(${JSON.stringify(payload)})` : "null"
  injectJavaScript(
    `;(function(){try{if(window.__FO_BRIDGE__&&typeof window.__FO_BRIDGE__.dispatch==='function'){window.__FO_BRIDGE__.dispatch(${JSON.stringify(
      type,
    )}, ${payloadExpr});}}catch(e){}})();`,
  )
})

export const dispatchToPage = bridgeQueue.dispatch

const attachWebView = (webview: WebViewRef | null) => {
  if (!webview) return
  jotaiStore.set(webviewAtom, webview)
  return () => {
    // The next entry's WebView may have taken over already
    if (jotaiStore.get(webviewAtom) !== webview) return
    jotaiStore.set(webviewAtom, null)
    bridgeQueue.reset()
  }
}

const onLoadEnd = () => {
  injectJavaScript(atEnd)
}

// The page loads from the app's files; any other page a link leads to opens outside the app
const onShouldStartLoadWithRequest = ({ url }: WebViewNavigation) => {
  if (url.startsWith("file:")) return true
  openLink(url)
  return false
}

// Article iframes get the same messaging interface as the page, which is the only local file
const isFromPage = (e: WebViewMessageEvent) => e.nativeEvent.url.startsWith("file:")

export const NativeWebView: React.ComponentType<
  ViewProps & {
    onContentHeightChange?: (e: { nativeEvent: { height: number } }) => void
    onSeekAudio?: (e: { time: number }) => void
    url?: string
  }
> = ({ onContentHeightChange, onSeekAudio }) => {
  const { openLightbox } = useLightboxControls()

  return (
    <WebView<WebViewProps>
      ref={attachWebView}
      style={styles.webview}
      containerStyle={styles.webviewContainer}
      source={{ uri: htmlUrl }}
      // Open chrome://inspect/#devices, or Development menu on Safari to debug the WebView.
      // https://github.com/react-native-webview/react-native-webview/blob/master/docs/Debugging.md#debugging-webview-contents
      webviewDebuggingEnabled={__DEV__}
      sharedCookiesEnabled
      originWhitelist={["*"]}
      allowUniversalAccessFromFileURLs
      // startInLoadingState
      allowsBackForwardNavigationGestures
      allowsFullscreenVideo
      injectedJavaScriptBeforeContentLoaded={atStart}
      // setSupportMultipleWindows={false}
      onOpenWindow={(e) => {
        const { targetUrl } = e.nativeEvent
        if (targetUrl) {
          openLink(targetUrl)
        }
      }}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onLoadEnd={onLoadEnd}
      onMessage={useTypeScriptHappyCallback(
        (e: WebViewMessageEvent) => {
          if (!isFromPage(e)) return
          try {
            const parsed = JSON.parse(e.nativeEvent.data) as PageToAppMessage
            switch (parsed.type) {
              case "bridgeReady": {
                assertBridgeVersion(parsed.payload?.version)
                bridgeQueue.ready()
                return
              }
              case "setContentHeight": {
                onContentHeightChange?.({
                  nativeEvent: { height: parsed.payload },
                })
                return
              }
              case "previewImage": {
                const { imageUrls, index } = parsed.payload
                runOnUI(() => {
                  "worklet"
                  // const rect = measureHandle(aviHandle)
                  runOnJS(openLightbox)({
                    images: imageUrls.map((url) => ({
                      uri: url,
                      dimensions: null,
                      thumbUri: url,
                      thumbDimensions: null,
                      thumbRect: null,
                      type: "image",
                    })),
                    index,
                  })
                })()
                return
              }
              case "audio:seekTo": {
                const { time } = parsed.payload
                if (typeof time !== "number") {
                  console.warn("Failed to seek audio! Invalid time", time)
                  return
                }
                onSeekAudio?.({ time })
                break
              }
              // No default
            }
          } catch (error) {
            console.warn("[webview] could not handle a message from the page", error)
          }
        },
        [onContentHeightChange, onSeekAudio, openLightbox],
      )}
    />
  )
}

const styles = {
  // https://github.com/react-native-webview/react-native-webview/issues/318#issuecomment-503979211
  webview: { backgroundColor: "transparent" },
  webviewContainer: { width: "100%", backgroundColor: "transparent" },
} as const
