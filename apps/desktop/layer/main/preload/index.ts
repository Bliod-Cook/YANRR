import os from "node:os"
import { platform } from "node:process"

import { electronAPI } from "@electron-toolkit/preload"
import { SERVER_URL_ARG } from "@follow/shared/desktop-launch"
import { getApiUrl } from "@follow/utils/server-url"
import { contextBridge } from "electron"

export const isMacOS = platform === "darwin"

export const isWindows = platform === "win32"

export const isLinux = platform === "linux"

/**
 * @see https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information
 * Windows 11 buildNumber starts from 22000.
 */
const detectingWindows11 = () => {
  if (!isWindows) return false

  const release = os.release()
  const majorVersion = Number.parseInt(release.split(".")[0]!)
  const buildNumber = Number.parseInt(release.split(".")[2]!)

  return majorVersion === 10 && buildNumber >= 22000
}

export const isWindows11 = detectingWindows11()

// Custom APIs for renderer
const api = {
  canWindowBlur: process.platform === "darwin" || (process.platform === "win32" && isWindows11),
  isWindowsStore: Boolean((process as typeof process & { windowsStore?: boolean }).windowsStore),
}

// The server the main process passed, read by `@follow/shared/env.desktop` before any renderer
// module runs. Missing until the user has set one.
const server = process.argv
  .find((arg) => arg.startsWith(SERVER_URL_ARG))
  ?.slice(SERVER_URL_ARG.length)
const followEnv = server ? { VITE_API_URL: getApiUrl(server), VITE_WEB_URL: server } : undefined

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld("api", api)
    contextBridge.exposeInMainWorld("platform", process.platform)
    if (followEnv) contextBridge.exposeInMainWorld("__followEnv", followEnv)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.platform = process.platform
  // @ts-ignore (define in dts)
  window.__followEnv = followEnv
}
