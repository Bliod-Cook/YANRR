import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

type Settings = Record<string, unknown>

const USER = "user-1"
const STORAGE_KEY = "follow:setting_sync_queue"
const LONG_AGO = "2020-01-01T00:00:00.000Z"

const rule = {
  id: "rule-1",
  enabled: true,
  pattern: "alpha",
  patternType: "keyword" as const,
  caseSensitive: false,
  color: "#FDE68A",
}

/** What the account holds on the server, and the changes this device sent to it. */
const server = {
  settings: {} as Record<string, Settings>,
  updated: {} as Record<string, string>,
  sent: [] as { tab: string; body: Settings }[],
}

/** Launch the app with what the profile has in localStorage, signed in. */
const launch = async () => {
  vi.resetModules()
  const { apiContext } = await import("@follow/store/context")
  const { useUserStore } = await import("@follow/store/user/store")
  const { getSyncModelHandler } = await import("@follow/store/sync/model-registry")
  const general = await import("~/atoms/settings/general")
  const ui = await import("~/atoms/settings/ui")
  const spotlight = await import("~/atoms/settings/spotlight")
  const ai = await import("~/atoms/settings/ai")
  const { doMigration } = await import("~/initialize/migrates")
  const { initializeSettings } = await import("~/initialize/settings")
  const { settingSyncQueue } = await import("./sync-queue")

  apiContext.provide({
    settings: {
      get: async () => ({ code: 0, settings: server.settings, updated: server.updated }),
      update: async ({ tab, ...body }: Settings & { tab: string }) => {
        server.sent.push({ tab, body })
        return { code: 0 }
      },
    },
  } as never)
  useUserStore.setState({ whoami: { id: USER } as never })

  await doMigration()
  initializeSettings()
  settingSyncQueue.init()

  return {
    ...general,
    ...ui,
    ...spotlight,
    ...ai,
    settingSyncQueue,
    /** The sync engine's first load of the account's settings */
    loadAccountSettings: () => getSyncModelHandler("setting")!.bootstrap!(),
  }
}

describe("desktop setting sync", () => {
  let app: Awaited<ReturnType<typeof launch>>

  beforeEach(async () => {
    vi.useFakeTimers()
    localStorage.clear()
    server.settings = {}
    server.updated = {}
    server.sent = []
    app = await launch()
  })

  afterEach(() => {
    app.settingSyncQueue.teardown()
    vi.useRealTimers()
    localStorage.clear()
  })

  test("sends each changed setting to its tab, except the device-local ones", async () => {
    app.setGeneralSetting("actionLanguage", "fr-FR")
    app.setGeneralSetting("language", "ja")
    app.setGeneralSetting("appLaunchOnStartup", true)
    app.setUISetting("wideMode", true)
    app.setUISetting("accentColor", "blue")
    app.setUISetting("uiFontFamily", "serif")
    app.setSpotlightSetting("spotlights", [rule])
    app.setAISetting("personalizePrompt", "Call me Captain.")

    await vi.advanceTimersByTimeAsync(1000)

    expect(server.sent).toEqual([
      { tab: "general", body: { actionLanguage: "fr-FR" } },
      { tab: "appearance", body: { wideMode: true, spotlights: [rule] } },
      { tab: "ai", body: { personalizePrompt: "Call me Captain." } },
    ])
  })

  test("takes the account's settings into their atoms, except the device-local ones", async () => {
    server.settings = {
      general: { unreadOnly: true, language: "fr-FR" },
      appearance: { uiTextSize: 18, accentColor: "blue", spotlights: [rule, { id: "broken" }] },
      ai: { personalizePrompt: "Call me Captain." },
    }
    server.updated = { general: LONG_AGO, appearance: LONG_AGO, ai: LONG_AGO }
    const { language } = app.getGeneralSettings()

    await app.loadAccountSettings()

    expect(app.getGeneralSettings()).toMatchObject({ unreadOnly: true, language })
    expect(app.getUISettings()).toMatchObject({ uiTextSize: 18, accentColor: "orange" })
    expect(app.getUISettings()).not.toHaveProperty("spotlights")
    expect(app.getSpotlightSettings()).toEqual({ spotlights: [rule] })
    expect(app.getAISettings().personalizePrompt).toBe("Call me Captain.")
  })

  test("a device-local setting changed here does not keep the account's settings out", async () => {
    server.settings = { general: { unreadOnly: true } }
    server.updated = { general: LONG_AGO }

    app.setGeneralSetting("language", "ja")
    await app.loadAccountSettings()

    expect(app.getGeneralSettings()).toMatchObject({ unreadOnly: true, language: "ja" })
  })

  test("a new profile takes the account's settings and sends none of its own", async () => {
    server.settings = { general: { unreadOnly: true, enhancedSettings: true } }
    server.updated = { general: LONG_AGO }

    await app.loadAccountSettings()
    await vi.advanceTimersByTimeAsync(1000)

    expect(app.getGeneralSettings()).toMatchObject({ unreadOnly: true, enhancedSettings: true })
    expect(server.sent).toEqual([])
  })

  test("keeps an unsent change in localStorage and sends it after a restart", async () => {
    app.setGeneralSetting("unreadOnly", true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      userId: USER,
      pending: { general: { unreadOnly: true } },
    })
    app.settingSyncQueue.teardown()

    app = await launch()
    await vi.advanceTimersByTimeAsync(1000)

    expect(server.sent).toEqual([{ tab: "general", body: { unreadOnly: true } }])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).pending).toEqual({})
  })
})
