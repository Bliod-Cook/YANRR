import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyScheduledLocalDataReset, scheduleLocalDataReset } from "./local-data-reset"
import { kvStoragePersister } from "./query-client"

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  files: new Set<string>(),
  failingDelete: null as string | null,
}))

vi.mock("@follow/database/constant", () => ({ SQLITE_DB_NAME: "follow.db" }))

vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => mocks.storage.get(key) ?? null,
    setItemSync: (key: string, value: string) => {
      mocks.storage.set(key, value)
    },
    removeItemSync: (key: string) => mocks.storage.delete(key),
  },
}))

vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///documents" },
  File: class {
    path: string
    constructor(...parts: string[]) {
      this.path = parts.join("/")
    }

    get exists() {
      return mocks.files.has(this.path)
    }

    delete() {
      if (this.path === mocks.failingDelete) throw new Error("I/O error")
      mocks.files.delete(this.path)
    }
  },
}))

const databaseFile = (name: string) => `file:///documents/SQLite/${name}`

describe("local data reset", () => {
  beforeEach(() => {
    mocks.storage.clear()
    mocks.files.clear()
    mocks.failingDelete = null
    for (const name of ["follow.db", "follow.db-wal", "follow.db-shm"]) {
      mocks.files.add(databaseFile(name))
    }
    mocks.files.add(databaseFile("other.db"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("leaves the database alone until a reset is scheduled", () => {
    applyScheduledLocalDataReset()

    expect(mocks.files.has(databaseFile("follow.db"))).toBe(true)
  })

  it("deletes the database and the files SQLite keeps next to it at the next launch", () => {
    scheduleLocalDataReset()
    // Scheduling deletes nothing, so the running app can still write until it reloads
    expect(mocks.files.has(databaseFile("follow.db"))).toBe(true)

    applyScheduledLocalDataReset()

    expect([...mocks.files]).toEqual([databaseFile("other.db")])
  })

  const storeSettings = () => {
    mocks.storage.set(
      "follow-rn-general",
      JSON.stringify({ language: "ja", unreadOnly: true, summary: false }),
    )
    mocks.storage.set(
      "follow-rn-ui",
      JSON.stringify({ fontScale: 1.2, showUnreadCountBadgeMobile: true, colorScheme: "dark" }),
    )
    mocks.storage.set("follow-rn-spotlight", JSON.stringify({ spotlights: [{ id: "rule" }] }))
    mocks.storage.set(
      "setting_sync_queue",
      JSON.stringify({
        userId: "user-a",
        pending: { general: { unreadOnly: true } },
        versions: {},
      }),
    )
  }

  it("leaves the key-value store alone when only the database is reset", () => {
    storeSettings()
    const stored = Object.fromEntries(mocks.storage)

    scheduleLocalDataReset()
    applyScheduledLocalDataReset()

    expect(mocks.files.has(databaseFile("follow.db"))).toBe(false)
    expect(Object.fromEntries(mocks.storage)).toEqual(stored)
  })

  it("leaves nothing of an account that leaves the device, except what is the device's", () => {
    const ofTheDevice = {
      "##Yanrr-Server-Url": JSON.stringify("https://rss.example.com"),
      "login:signed-in-before": "1",
      listSortMethod: JSON.stringify("count"),
    }
    for (const [key, value] of Object.entries(ofTheDevice)) mocks.storage.set(key, value)
    storeSettings()
    // The responses the query client keeps, written the way the app has it write them
    vi.useFakeTimers()
    kvStoragePersister.persistClient({ buster: "", timestamp: 0, clientState: {} as never })
    vi.runAllTimers()
    expect(mocks.storage.size).toBe(8)

    scheduleLocalDataReset("account")
    applyScheduledLocalDataReset()

    expect(mocks.files.has(databaseFile("follow.db"))).toBe(false)
    expect(Object.fromEntries(mocks.storage)).toEqual({
      ...ofTheDevice,
      "follow-rn-general": JSON.stringify({ language: "ja" }),
      "follow-rn-ui": JSON.stringify({ fontScale: 1.2, showUnreadCountBadgeMobile: true }),
    })
  })

  it("resets once", () => {
    scheduleLocalDataReset()
    applyScheduledLocalDataReset()
    mocks.files.add(databaseFile("follow.db"))

    applyScheduledLocalDataReset()

    expect(mocks.files.has(databaseFile("follow.db"))).toBe(true)
  })

  it("tries again at the next launch when the database could not be deleted", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    scheduleLocalDataReset()
    mocks.failingDelete = databaseFile("follow.db")

    expect(() => applyScheduledLocalDataReset()).not.toThrow()
    expect(mocks.files.has(databaseFile("follow.db"))).toBe(true)

    mocks.failingDelete = null
    applyScheduledLocalDataReset()

    expect(mocks.files.has(databaseFile("follow.db"))).toBe(false)
  })
})
