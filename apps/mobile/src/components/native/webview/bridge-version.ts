import { WEBVIEW_BRIDGE_VERSION } from "@follow/shared/webview-bridge"

/** Throws when the renderer page the app bundles speaks another bridge version than the app */
export const assertBridgeVersion = (version: unknown) => {
  if (version !== WEBVIEW_BRIDGE_VERSION) {
    throw new Error(
      `The entry renderer speaks bridge version ${String(version)}, the app ${WEBVIEW_BRIDGE_VERSION}: run expo prebuild to rebuild it`,
    )
  }
}
