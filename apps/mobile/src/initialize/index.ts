import { initializeDB, migrateDB } from "@follow/database/db"
import { hydrateDatabaseToStore } from "@follow/store/hydrate"
import { ensureSyncedThroughEngine } from "@follow/store/sync/sync-status"
import { whoami } from "@follow/store/user/getters"
import { fetchSessionUser } from "@follow/store/user/hooks"

import { applyStoredAppColorScheme } from "../lib/color-scheme"
import { settingSyncQueue } from "../modules/settings/sync-queue"
import { initializeDayjs } from "./dayjs"
import { initDeviceType } from "./device"
import { hydrateQueryClient, hydrateSettings } from "./hydrate"
import { initializePlayer } from "./player"
import { setStartupFailed, setStartupReady } from "./startup"
import { initSyncTriggers } from "./sync"

type RequestIdleCallback = (callback: () => void, options?: { timeout?: number }) => number

const runWhenIdle = (callback: () => void) => {
  const requestIdle = (globalThis as { requestIdleCallback?: RequestIdleCallback })
    .requestIdleCallback

  if (requestIdle) {
    requestIdle(callback, { timeout: 5000 })
    return
  }

  setTimeout(callback, 0)
}

/** Runs a stage that the app cannot start without; a failure is shown on the startup screen */
const runStage = async (label: string, fn: () => Promise<unknown> | unknown) => {
  try {
    await apm(label, fn)
    return true
  } catch (error) {
    console.error(`${label} failed`, error)
    setStartupFailed(error instanceof Error ? error : new Error(String(error)))
    return false
  }
}

/** The app is ready, see `appReady`, once the database is migrated and the stores are hydrated */
export const initializeApp = async () => {
  console.log(`Initialize...`)

  const now = Date.now()

  // Apply the persisted color scheme before the first frame to avoid a theme flash.
  applyStoredAppColorScheme()

  const started =
    (await runStage("initDeviceType", initDeviceType)) &&
    (await runStage("migrateDatabase", async () => {
      await initializeDB()
      await migrateDB()
    })) &&
    (await runStage("hydrate", async () => {
      initializeDayjs()
      await hydrateSettings()
      await hydrateDatabaseToStore()
      await hydrateQueryClient()
    }))
  if (!started) return
  setStartupReady()

  runWhenIdle(() => {
    void apm("initializePlayer", initializePlayer)
  })

  void apm("setting sync", async () => {
    await settingSyncQueue.init()

    await fetchSessionUser().catch(() => null)

    if (!whoami()) {
      return
    }
    // With a sync cursor the settings were loaded in full once and are kept current by the
    // change log (see the "setting" model in the sync queue). Only servers without it still
    // need the full request on every launch.
    if (await ensureSyncedThroughEngine()) {
      return
    }
    await settingSyncQueue.syncLocal()
  }).catch((error) => {
    console.error("setting sync failed", error)
  })
  const loadingTime = Date.now() - now

  initSyncTriggers()
  console.log(`Initialize done,`, `${loadingTime}ms`)
}

const apm = async (label: string, fn: () => Promise<unknown> | unknown) => {
  const start = Date.now()
  const result = await fn()
  const end = Date.now()
  console.log(`${label} took ${end - start}ms`)
  return result
}
