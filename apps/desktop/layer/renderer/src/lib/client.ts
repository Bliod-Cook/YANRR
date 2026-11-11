import type { IpcServices } from "@follow/electron-main"
import type { IpcRenderer } from "electron"
import { createIpcProxy } from "electron-ipc-decorator/client"

// Of `ipcRenderer`, the proxy uses `invoke` alone, which is what the preload script hands over
export const ipcServices = createIpcProxy<IpcServices>(window.electron as unknown as IpcRenderer)
