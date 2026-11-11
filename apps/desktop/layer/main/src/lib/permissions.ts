import { isAppPage } from "./page-origin"

/**
 * What the app's own pages use: copying, importing rules from the clipboard, and handing links
 * of other apps, such as its own deep links, to the system.
 */
const APP_PAGE_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "clipboard-read",
  "openExternal",
])

/**
 * Whether the page at `url` may use `permission`. Electron grants everything unless told
 * otherwise, and the windows also show pages of the web, in webviews and frames: those get to
 * show a video full screen and nothing else, so no camera, microphone or location.
 */
export const isPermissionGranted = (permission: string, url: string) =>
  permission === "fullscreen" || (APP_PAGE_PERMISSIONS.has(permission) && isAppPage(url))
