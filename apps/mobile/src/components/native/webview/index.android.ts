import { dispatchToPage, injectJavaScript } from "./native-webview.android"

export const SharedWebViewModule = {
  load: () => {
    console.warn("SharedWebViewModule.load is not implemented on Android")
  },
  evaluateJavaScript: (js: string) => {
    injectJavaScript(js)
  },
  dispatch: dispatchToPage,
}

export const prepareEntryRenderWebView = () => {}
