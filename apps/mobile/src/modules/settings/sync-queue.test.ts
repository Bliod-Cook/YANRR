import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Settings = Record<string, unknown>

const mocks = vi.hoisted(() => {
  // Read by the shared constants at import
  vi.stubGlobal("ELECTRON", false)
  // The setting atoms report their changes on the event bus. Vitest loads its web variant,
  // which needs a window; the app loads the one for React Native.
  vi.stubGlobal("window", new EventTarget())
  return { kv: new Map<string, string>() }
})

vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => mocks.kv.get(key) ?? null,
    setItemSync: (key: string, value: string) => {
      mocks.kv.set(key, value)
    },
    removeItemSync: (key: string) => {
      mocks.kv.delete(key)
    },
  },
}))
// The local data reset deletes the database files as well
vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///documents" },
  File: class {
    exists = false
  },
}))
// The setting atoms take their default language from the device
vi.mock("@/src/lib/i18n", () => ({ getDeviceLanguage: () => "en" }))

const STORAGE_KEY = "setting_sync_queue"
const LONG_AGO = "2020-01-01T00:00:00.000Z"

const rule = {
  id: "rule-1",
  enabled: true,
  pattern: "alpha",
  patternType: "keyword" as const,
  caseSensitive: false,
  color: "#FDE68A",
}

/** The changes this device sent to the server, and whether the server can be reached. */
const server = { sent: [] as { userId: string; tab: string; body: Settings }[], isDown: false }

/** Launch the app with what the device has in its key-value store, signed in as `userId`. */
const launch = async (userId: string) => {
  vi.resetModules()
  // Before anything else, as in the app
  const { applyScheduledLocalDataReset, scheduleLocalDataReset } =
    await import("../../lib/local-data-reset")
  applyScheduledLocalDataReset()

  const { apiContext } = await import("@follow/store/context")
  const { useUserStore } = await import("@follow/store/user/store")
  const { getSyncModelHandler } = await import("@follow/store/sync/model-registry")
  const general = await import("../../atoms/settings/general")
  const ui = await import("../../atoms/settings/ui")
  const spotlight = await import("../../atoms/settings/spotlight")
  const { settingSyncQueue } = await import("./sync-queue")

  apiContext.provide({
    settings: {
      get: async () => {
        throw new Error("The account's settings were requested")
      },
      update: async ({ tab, ...body }: Settings & { tab: string }) => {
        if (server.isDown) throw new TypeError("Network request failed")
        server.sent.push({ userId, tab, body })
        return { code: 0 }
      },
    },
  } as never)
  useUserStore.setState({ whoami: { id: userId } as never })

  general.initializeDefaultGeneralSettings()
  ui.initializeDefaultUISettings()
  spotlight.initializeDefaultSpotlightSettings()
  settingSyncQueue.init()

  let logged = 0
  return {
    ...general,
    ...ui,
    ...spotlight,
    settingSyncQueue,
    scheduleLocalDataReset,
    /** The sync engine reports a tab that changed on the server. */
    report: (tab: string, payload?: Settings) =>
      getSyncModelHandler("setting")!.apply({
        id: (logged += 1),
        model: "setting",
        modelId: tab,
        action: "U",
        data: { payload, updatedAt: LONG_AGO },
        createdAt: LONG_AGO,
      }),
  }
}

describe("mobile setting sync", () => {
  let app: Awaited<ReturnType<typeof launch>>

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.kv.clear()
    server.sent = []
    server.isDown = false
    app = await launch("user-a")
  })

  afterEach(() => {
    app.settingSyncQueue.teardown()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("sends each changed setting to its tab, except the device-local ones", async () => {
    app.setGeneralSetting("unreadOnly", true)
    app.setGeneralSetting("language", "ja")
    app.setUISetting("colorScheme", "dark")
    app.setUISetting("fontScale", 1.2)
    app.setUISetting("showUnreadCountBadgeMobile", true)
    app.setSpotlightSetting("spotlights", [rule])

    await vi.advanceTimersByTimeAsync(1000)

    expect(server.sent).toEqual([
      { userId: "user-a", tab: "general", body: { unreadOnly: true } },
      { userId: "user-a", tab: "appearance", body: { colorScheme: "dark", spotlights: [rule] } },
    ])
  })

  it("takes the account's settings into their atoms, except the device-local ones", async () => {
    app.setUISetting("fontScale", 1.2)

    await app.report("general", { unreadOnly: true, language: "fr-FR" })
    await app.report("appearance", {
      colorScheme: "dark",
      fontScale: 2,
      showUnreadCountBadgeMobile: true,
      spotlights: [rule, { id: "broken" }],
    })
    // The desktop app's AI settings, logged without their values
    await app.report("ai")

    expect(app.getGeneralSettings()).toMatchObject({ unreadOnly: true, language: "en" })
    expect(app.getUISettings()).toMatchObject({
      colorScheme: "dark",
      fontScale: 1.2,
      showUnreadCountBadgeMobile: false,
    })
    expect(app.getSpotlightSettings()).toEqual({ spotlights: [rule] })
  })

  it("keeps an unsent change in the key-value store and sends it after a restart", async () => {
    server.isDown = true
    app.setGeneralSetting("unreadOnly", true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(JSON.parse(mocks.kv.get(STORAGE_KEY)!).pending).toEqual({
      general: { unreadOnly: true },
    })
    app.settingSyncQueue.teardown()

    server.isDown = false
    app = await launch("user-a")
    await vi.advanceTimersByTimeAsync(1000)

    expect(server.sent).toEqual([{ userId: "user-a", tab: "general", body: { unreadOnly: true } }])
    expect(JSON.parse(mocks.kv.get(STORAGE_KEY)!).pending).toEqual({})
  })

  it("leaves the next account none of the settings of the one before, only the device's", async () => {
    app.setGeneralSetting("unreadOnly", true)
    app.setGeneralSetting("language", "ja")
    app.setUISetting("colorScheme", "dark")
    app.setUISetting("fontScale", 1.2)
    app.setSpotlightSetting("spotlights", [rule])
    await vi.advanceTimersByTimeAsync(1000)
    // Not sent before the account signs out
    server.isDown = true
    app.setGeneralSetting("dimRead", true)
    server.sent = []
    app.settingSyncQueue.teardown()

    // Signing out, switching the server and a session of another account all end like this
    app.scheduleLocalDataReset("account")
    server.isDown = false
    app = await launch("user-b")
    await vi.advanceTimersByTimeAsync(1000)

    expect(app.getGeneralSettings()).toMatchObject({
      unreadOnly: false,
      dimRead: false,
      language: "ja",
    })
    expect(app.getUISettings()).toMatchObject({ colorScheme: "system", fontScale: 1.2 })
    expect(app.getSpotlightSettings()).toEqual({ spotlights: [] })
    expect(server.sent).toEqual([])
  })
})
