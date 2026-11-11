import { app } from "electron"
import path from "pathe"

import { store, StoreKey } from "./store"

// Chromium's HTTP cache. The name is capitalized, which matters on Linux.
export const getCacheDir = () => path.join(app.getPath("userData"), "Cache")

/**
 * Has Chromium keep its HTTP cache within the limit the user set, dropping what it used least.
 * Chromium reads the size once the app is ready, so this runs before, and a limit set later
 * applies from the next launch.
 */
export const applyCacheSizeLimit = () => {
  const limitInMB = store.get(StoreKey.CacheSizeLimit)
  if (!limitInMB) return
  app.commandLine.appendSwitch("disk-cache-size", String(limitInMB * 1024 * 1024))
}
