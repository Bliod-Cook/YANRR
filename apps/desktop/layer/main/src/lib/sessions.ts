import { session } from "electron"

/**
 * Webviews show pages of the web, so they get a session of their own: none of the app page's
 * storage and cookies, the user's session with the server among them, and no app protocol.
 * Persistent, so that sites stay signed in as before.
 */
export const WEBVIEW_PARTITION = "persist:webview"

export const getWebviewSession = () => session.fromPartition(WEBVIEW_PARTITION)

/** The app page's session and that of its webviews, which share the network settings */
export const getSessions = () => [session.defaultSession, getWebviewSession()]
