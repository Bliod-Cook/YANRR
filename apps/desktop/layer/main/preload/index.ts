import { SERVER_URL_ARG } from "@follow/shared/desktop-launch"
import { contextBridge, ipcRenderer } from "electron"

import { CHANNELS_FROM_PAGE, CHANNELS_TO_PAGE, IPC_SERVICE_GROUPS } from "../src/ipc/channels"
import { APP_API_URL } from "../src/lib/app-url"

/**
 * @see https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information
 * Windows 11 buildNumber starts from 22000.
 */
const isWindows11 = () => {
  // A sandboxed preload script has no `os`
  const [majorVersion, , buildNumber] = process.getSystemVersion().split(".")
  return Number.parseInt(majorVersion!) === 10 && Number.parseInt(buildNumber!) >= 22000
}

const assertListed = (channels: readonly string[], channel: string) => {
  if (!channels.includes(channel)) throw new Error(`IPC channel not allowed: ${channel}`)
}

const isServiceMethod = (channel: string) =>
  IPC_SERVICE_GROUPS.some((group) => channel.startsWith(`${group}.`))

/**
 * All a page gets of Electron: the pages show HTML from feeds, so they run without Node and
 * apart from this script, and reach the main process through the channels listed in
 * `ipc/channels` only.
 */
const electron = {
  /** Calls a method of the main process's IPC services, named `<group>.<method>` */
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isServiceMethod(channel)) throw new Error(`IPC channel not allowed: ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  send(channel: string, payload?: unknown) {
    assertListed(CHANNELS_FROM_PAGE, channel)
    ipcRenderer.send(channel, payload)
  },
  /**
   * Listens to the main process until the returned function is called. The listener gets the
   * payload alone: the event would hand the page the whole `ipcRenderer`.
   */
  on<Payload>(channel: string, listener: (payload: Payload) => void) {
    assertListed(CHANNELS_TO_PAGE, channel)
    const onMessage = (_event: Electron.IpcRendererEvent, payload: Payload) => listener(payload)
    ipcRenderer.on(channel, onMessage)
    return () => {
      ipcRenderer.removeListener(channel, onMessage)
    }
  },
}

export type ElectronBridge = typeof electron

const api = {
  canWindowBlur: process.platform === "darwin" || (process.platform === "win32" && isWindows11()),
}

// The server the main process passed, read by `@follow/shared/env.desktop` before any renderer
// module runs. Missing until the user has set one. The main process answers for its API.
const server = process.argv
  .find((arg) => arg.startsWith(SERVER_URL_ARG))
  ?.slice(SERVER_URL_ARG.length)

contextBridge.exposeInMainWorld("electron", electron)
contextBridge.exposeInMainWorld("api", api)
contextBridge.exposeInMainWorld("platform", process.platform)
if (server) {
  contextBridge.exposeInMainWorld("__followEnv", {
    VITE_API_URL: APP_API_URL,
    VITE_WEB_URL: server,
  })
}
