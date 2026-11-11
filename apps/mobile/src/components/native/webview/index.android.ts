import { dispatchToPage } from "./native-webview.android"

export const SharedWebViewModule = {
  load: () => {
    console.warn("SharedWebViewModule.load is not implemented on Android")
  },
  dispatch: dispatchToPage,
}

export const prepareEntryRenderWebView = () => {}
