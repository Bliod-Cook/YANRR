import { SQLITE_DB_NAME } from "@follow/database/constant"
import { File, Paths } from "expo-file-system"
import Storage from "expo-sqlite/kv-store"

import {
  generalLocalOnlyKeys,
  getSettingStorageKey,
  SETTING_SYNC_QUEUE_STORAGE_KEY,
  uiLocalOnlyKeys,
} from "../atoms/settings/internal/storage"

const RESET_SCHEDULED_KEY = "localDataResetScheduled"

/**
 * `database`: the local database only, which the server fills again for the account.
 * `account`: everything of the account on this device, for when it leaves the device.
 */
type LocalDataResetScope = "database" | "account"

// SQLite keeps an open database's write-ahead log and shared memory next to it. A log left
// behind would be replayed into the next database of that name.
const DATABASE_FILE_NAMES = ["", "-wal", "-shm", "-journal"].map(
  (suffix) => `${SQLITE_DB_NAME}${suffix}`,
)

/**
 * What the key-value store holds of the account besides its settings: the spotlight rules, the
 * setting changes not sent yet, and the responses the query client persists under the key
 * `createSyncStoragePersister` uses unless it is given another.
 */
const ACCOUNT_STORAGE_KEYS = [
  getSettingStorageKey("spotlight"),
  SETTING_SYNC_QUEUE_STORAGE_KEY,
  "REACT_QUERY_OFFLINE_CACHE",
]

/** The device-local settings stay; the others are the account's and return to their defaults. */
const keepLocalOnlySettings = (settingKey: string, localOnlyKeys: readonly string[]) => {
  const storageKey = getSettingStorageKey(settingKey)
  const stored = Storage.getItemSync(storageKey)
  if (!stored) return

  const settings = JSON.parse(stored) as Record<string, unknown>
  const kept = Object.fromEntries(
    localOnlyKeys.filter((key) => key in settings).map((key) => [key, settings[key]]),
  )
  Storage.setItemSync(storageKey, JSON.stringify(kept))
}

/**
 * Have the next launch delete the local data, before anything loads it. Deleting the database
 * from under the running app would fail every write still under way until the app reloads:
 * SQLite refuses writes to a database file that was deleted while open.
 */
export const scheduleLocalDataReset = (scope: LocalDataResetScope = "database") => {
  Storage.setItemSync(RESET_SCHEDULED_KEY, scope)
}

/** Deletes the local data when a reset was scheduled. Runs before anything loads it. */
export const applyScheduledLocalDataReset = () => {
  const scope = Storage.getItemSync(RESET_SCHEDULED_KEY)
  if (!scope) return

  try {
    for (const name of DATABASE_FILE_NAMES) {
      const file = new File(Paths.document, "SQLite", name)
      if (file.exists) file.delete()
    }
    if (scope === "account") {
      for (const key of ACCOUNT_STORAGE_KEYS) {
        Storage.removeItemSync(key)
      }
      keepLocalOnlySettings("general", generalLocalOnlyKeys)
      keepLocalOnlySettings("ui", uiLocalOnlyKeys)
    }
  } catch (error) {
    // The reset stays scheduled, so the next launch tries again
    console.error("[local-data-reset] failed to delete the local data", error)
    return
  }
  Storage.removeItemSync(RESET_SCHEDULED_KEY)
}
