// Without imports, so that the preload script can share it with the main process.

/** The origin of the packaged app's pages, which the `app` protocol serves */
export const APP_ORIGIN = "app://yanrr"

/**
 * Where the app's pages find the API of whichever server the user set: on their own origin,
 * like the web app. The main process answers there with the server's answer, see `api-proxy`.
 */
export const APP_API_URL = `${APP_ORIGIN}/api`
