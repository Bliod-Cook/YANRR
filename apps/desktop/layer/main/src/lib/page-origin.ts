import { is } from "@electron-toolkit/utils"

import { APP_ORIGIN } from "./app-url"

/** The dev server the app's pages load from while developing, instead of the app protocol */
export const getDevServerUrl = () => (is.dev && process.env.ELECTRON_RENDERER_URL) || null

/** The origin of the app's own pages. Whatever else runs in a window or a webview is not the app. */
export const getPageOrigin = () => {
  const devServerUrl = getDevServerUrl()
  return devServerUrl ? new URL(devServerUrl).origin : APP_ORIGIN
}

/** Whether `url` is of one of the app's own pages */
export const isAppPage = (url: string) => {
  try {
    // Node gives the URLs of the app protocol no origin
    const { protocol, host } = new URL(url)
    return `${protocol}//${host}` === getPageOrigin()
  } catch {
    return false
  }
}
