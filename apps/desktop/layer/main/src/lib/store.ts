import type { Credentials } from "@eneris/push-receiver/dist/types"
import Store from "electron-store"

// @keep-sorted
type StoreData = {
  "notifications-credentials"?: Credentials | null
  "notifications-persistent-ids"?: string[] | null
  appearance?: "light" | "dark" | "system" | null
  cacheSizeLimit?: number | null
  eagleContextMenuEnabled?: boolean | null
  minimizeToTray?: boolean | null
  proxy?: string | null
  /**
   * The session id qBittorrent gave, with the host it is for. An id that earlier builds kept
   * alone has no host, so it is never sent, and the next login replaces it.
   */
  qbittorrentSID?: { host: string; sid: string } | null
  /** The server's address, see `server-url.ts` */
  serverUrl?: string | null
  windowState?: {
    height: number
    isMaximized?: boolean
    width: number
    x: number
    y: number
  } | null
}
export const store = new Store<StoreData>({ name: "db" })

export enum StoreKey {
  CacheSizeLimit = "cacheSizeLimit",
}
