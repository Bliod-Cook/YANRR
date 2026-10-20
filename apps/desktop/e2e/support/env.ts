import { fileURLToPath } from "node:url"

import { join } from "pathe"

export interface DesktopE2EEnv {
  /** The Yannr server: the web dev server forwards `/api` to it, Electron talks to it directly */
  serverURL: string
  apiURL: string
  webURL: string
  webBaseURL: string
  desktopAppDir: string
}

const supportDir = fileURLToPath(new URL(".", import.meta.url))
const desktopAppDir = join(supportDir, "..", "..")

/** Serves `FEED_FIXTURE` for the server to subscribe to (see `feed-server.mjs`). */
export const FEED_SERVER_PORT = 2299

const normalizeRoute = (route: string) => {
  if (!route || route === "/") {
    return "/"
  }

  return route.startsWith("/") ? route : `/${route}`
}

/**
 * The web dev server proxies `/api` to a running Yannr server (`VITE_DEV_PROXY_TARGET`), so the
 * app and the API share an origin like they do when the server hosts the web build.
 */
export const resolveDesktopE2EEnv = (): DesktopE2EEnv => {
  const webBaseURL = process.env.YANNR_E2E_WEB_URL ?? "http://localhost:2233"

  return {
    serverURL: process.env.VITE_DEV_PROXY_TARGET ?? "http://localhost:3000",
    apiURL: `${webBaseURL}/api`,
    webURL: webBaseURL,
    webBaseURL,
    desktopAppDir,
  }
}

export const buildWebAppURL = (env: DesktopE2EEnv, route = "/") =>
  new URL(normalizeRoute(route), `${env.webBaseURL}/`).toString()
