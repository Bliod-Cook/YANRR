// @vitest-environment happy-dom
import { fromAppearanceSpotlightPayload } from "@follow/shared/spotlight"
import { EventBus } from "@follow/utils/event-bus"
import { jotaiStore } from "@follow/utils/jotai"
import { FollowAPIError } from "@follow-app/client-sdk"
import { atom } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FollowAPI } from "../api-contract"
import { apiContext } from "../context"
import type { MeModel } from "../modules/user/store"
import { useUserStore } from "../modules/user/store"
import { getSyncModelHandler } from "./model-registry"
import type { SettingSyncQueue } from "./setting-sync-queue"
import { createSettingSyncQueue } from "./setting-sync-queue"
import type { SyncAction } from "./types"

type Settings = Record<string, unknown>

const USER = "user-1"
const STORAGE_KEY = "setting_sync_queue"

const signIn = (userId: string | null) =>
  useUserStore.setState({ whoami: userId ? ({ id: userId } as MeModel) : null })

/**
 * The settings endpoints as the server implements them: a PATCH merges its keys into the tab,
 * stamps the tab with the server's time and logs the tab as it is afterwards. Other devices of
 * an account are played by calling `patch`.
 */
const createServer = () => {
  // The server's clock, years behind this device's
  let clock = Date.parse("2020-01-01T00:00:00.000Z")
  const accounts = new Map<string, Map<string, { payload: Settings; updatedAt: string }>>()
  const log: (SyncAction & { userId: string })[] = []
  const requests: ({ get: true } | { tab: string; body: Settings })[] = []
  const connection = {
    /** Every request fails with this while it is set. */
    error: null as unknown,
    /** Requests wait for this before they reach the server. */
    hold: null as Promise<void> | null,
  }

  const tabsOf = (userId: string) => {
    if (!accounts.has(userId)) accounts.set(userId, new Map())
    return accounts.get(userId)!
  }
  const patch = (userId: string, tab: string, body: Settings) => {
    clock += 1000
    const updatedAt = new Date(clock).toISOString()
    const payload = { ...tabsOf(userId).get(tab)?.payload, ...body }
    tabsOf(userId).set(tab, { payload, updatedAt })
    const id = log.length + 1
    // The ai tab holds API keys, which are not copied into the log
    const data = tab === "ai" ? { updatedAt } : { payload: { ...payload }, updatedAt }
    log.push({
      id,
      model: "setting",
      modelId: tab,
      action: "U",
      data,
      createdAt: updatedAt,
      userId,
    })
    return { code: 0 as const, lastSyncId: id }
  }
  const reach = async () => {
    await connection.hold
    if (connection.error) throw connection.error
    return useUserStore.getState().whoami!.id
  }

  apiContext.provide({
    settings: {
      get: async () => {
        requests.push({ get: true })
        const tabs = Array.from(tabsOf(await reach()))
        return {
          code: 0,
          settings: Object.fromEntries(tabs.map(([tab, { payload }]) => [tab, { ...payload }])),
          updated: Object.fromEntries(tabs.map(([tab, { updatedAt }]) => [tab, updatedAt])),
        }
      },
      update: async ({ tab, ...body }: Settings & { tab: string }) => {
        requests.push({ tab, body })
        return patch(await reach(), tab, body)
      },
    },
  } as unknown as FollowAPI)

  return {
    log,
    requests,
    connection,
    patch,
    tab: (tab: string, userId = USER) => tabsOf(userId).get(tab)?.payload,
  }
}

type Server = ReturnType<typeof createServer>

const createRule = (pattern: string) => ({
  id: pattern,
  enabled: true,
  pattern,
  patternType: "keyword",
  caseSensitive: false,
  color: "#FDE68A",
})

describe("setting sync queue", () => {
  let server: Server
  let stored: Map<string, string>
  let queue: SettingSyncQueue
  let cursor: number

  const atoms = {
    general: atom<Settings>({}),
    ui: atom<Settings>({}),
    spotlight: atom<Settings>({}),
    ai: atom<Settings>({}),
  }
  const settings = (domain: keyof typeof atoms) => jotaiStore.get(atoms[domain])

  /** The app's modules load, on this device or on a new one when nothing is stored. */
  const load = ({ syncsAi = true } = {}) => {
    queue?.teardown()
    jotaiStore.set(atoms.general, { language: "en", unreadOnly: false, dimRead: false })
    jotaiStore.set(atoms.ui, { uiFontFamily: "system-ui", uiTextSize: 16, wideMode: false })
    jotaiStore.set(atoms.spotlight, { spotlights: [] })
    jotaiStore.set(atoms.ai, { personalizePrompt: "" })
    queue = createSettingSyncQueue({
      storage: {
        read: () => stored.get(STORAGE_KEY) ?? null,
        write: (value) => {
          stored.set(STORAGE_KEY, value)
        },
      },
      domains: {
        general: { tab: "general", atom: atoms.general, localOnlyKeys: ["language"] },
        ui: { tab: "appearance", atom: atoms.ui, localOnlyKeys: ["uiFontFamily"] },
        spotlight: {
          tab: "appearance",
          atom: atoms.spotlight,
          keys: ["spotlights"],
          normalize: fromAppearanceSpotlightPayload,
        },
        ...(syncsAi && { ai: { tab: "ai", atom: atoms.ai } }),
      },
    })
    cursor = 0
  }

  const launch = (options?: Parameters<typeof load>[0]) => {
    load(options)
    queue.init()
  }

  /** A setting changed in the UI: its atom takes the value and reports the change. */
  const change = (domain: keyof typeof atoms, key: string, value: unknown) => {
    jotaiStore.set(atoms[domain], { ...settings(domain), [key]: value })
    EventBus.dispatch("SETTING_CHANGE_EVENT", { key: domain, payload: { [key]: value } })
  }

  /** The delay after which changes are sent, and the requests that send them. */
  const sent = () => vi.advanceTimersByTimeAsync(1000)

  /** The sync engine delivers what the server logged for the account since its last pull. */
  const pull = async () => {
    const userId = useUserStore.getState().whoami?.id
    const actions = server.log.filter((action) => action.id > cursor && action.userId === userId)
    cursor = server.log.length
    for (const action of actions) {
      await getSyncModelHandler("setting")!.apply(action)
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime("2026-11-11T10:00:00.000Z")
    vi.spyOn(console, "error").mockImplementation(() => {})
    server = createServer()
    stored = new Map()
    signIn(USER)
    launch()
  })

  afterEach(() => {
    queue.teardown()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe("taking the account's settings", () => {
    it("takes another device's change after a device-local setting changed here", async () => {
      server.patch(USER, "general", { unreadOnly: true })

      change("general", "language", "ja")
      await pull()

      expect(settings("general")).toMatchObject({ unreadOnly: true, language: "ja" })
    })

    it("takes another device's change made after its own, however far the clocks are apart", async () => {
      // Stamped by the server, whose clock is years behind this device's
      change("general", "unreadOnly", true)
      await sent()
      await pull()

      server.patch(USER, "general", { dimRead: true })
      await pull()

      expect(settings("general")).toMatchObject({ unreadOnly: true, dimRead: true })
    })

    it("takes the account's settings on a new device, however long ago they changed", async () => {
      server.patch(USER, "general", { unreadOnly: true })
      vi.setSystemTime("2030-01-01T00:00:00.000Z")

      await getSyncModelHandler("setting")!.bootstrap!()

      expect(settings("general").unreadOnly).toBe(true)
    })

    it("keeps a setting whose change waits to be sent, and takes the rest of its tab", async () => {
      server.connection.error = new TypeError("Failed to fetch")
      change("general", "unreadOnly", true)
      await sent()
      server.patch(USER, "general", { unreadOnly: false, dimRead: true })

      server.connection.error = null
      await pull()
      expect(settings("general")).toMatchObject({ unreadOnly: true, dimRead: true })

      queue.resume()
      await sent()
      await pull()
      expect(server.tab("general")).toEqual({ unreadOnly: true, dimRead: true })
      expect(settings("general")).toMatchObject({ unreadOnly: true, dimRead: true })
    })

    it("does not bring back a setting as it was before a change the server already has", async () => {
      change("general", "dimRead", true)
      await sent()
      change("general", "dimRead", false)
      await sent()

      // The log hides what it recorded within the last second: only the first change is in it
      await getSyncModelHandler("setting")!.apply(server.log[0]!)
      expect(settings("general").dimRead).toBe(false)

      await getSyncModelHandler("setting")!.apply(server.log[1]!)
      expect(settings("general").dimRead).toBe(false)
    })

    it("does not go back to a version of a tab older than the one it has", async () => {
      server.patch(USER, "general", { unreadOnly: true })
      server.patch(USER, "general", { unreadOnly: false })

      await queue.syncLocal()
      // The log goes on from before the full load, with the first of the two changes
      await getSyncModelHandler("setting")!.apply(server.log[0]!)

      expect(settings("general").unreadOnly).toBe(false)
    })

    it("reads a tab that is logged without its settings through the settings endpoint", async () => {
      server.patch(USER, "ai", { personalizePrompt: "Call me Captain." })

      await pull()

      expect(server.requests).toEqual([{ get: true }])
      expect(settings("ai").personalizePrompt).toBe("Call me Captain.")
    })

    it("reports a full load that failed to its caller", async () => {
      server.connection.error = new FollowAPIError("unavailable", 503)

      await expect(queue.syncLocal()).rejects.toThrow("unavailable")
    })
  })

  describe("what is sent and taken", () => {
    it("sends only the changed keys, also to a tab two domains share, without reading it first", async () => {
      const rule = createRule("alpha")
      server.patch(USER, "appearance", { uiTextSize: 18 })

      change("spotlight", "spotlights", [rule])
      change("ui", "wideMode", true)
      change("general", "unreadOnly", true)
      await sent()

      expect(server.requests).toEqual([
        { tab: "appearance", body: { spotlights: [rule], wideMode: true } },
        { tab: "general", body: { unreadOnly: true } },
      ])
      // What the other device changed meanwhile is still there
      expect(server.tab("appearance")).toEqual({
        uiTextSize: 18,
        spotlights: [rule],
        wideMode: true,
      })
    })

    it("gives each domain of a shared tab its own settings, in a form it can use", async () => {
      const rule = createRule("alpha")
      server.patch(USER, "appearance", { uiTextSize: 18, spotlights: [rule, { id: "broken" }] })

      await pull()

      expect(settings("ui")).toEqual({ uiFontFamily: "system-ui", uiTextSize: 18, wideMode: false })
      expect(settings("spotlight")).toEqual({ spotlights: [rule] })
    })

    it("keeps device-local settings on the device, both ways", async () => {
      change("general", "language", "ja")
      change("ui", "uiFontFamily", "serif")
      await sent()
      expect(server.requests).toEqual([])

      // Stored with the account by an app that syncs them
      server.patch(USER, "general", { language: "fr", unreadOnly: true })
      await pull()

      expect(settings("general")).toMatchObject({ language: "ja", unreadOnly: true })
    })

    it("ignores settings and tabs it has no domain for", async () => {
      launch({ syncsAi: false })
      EventBus.dispatch("SETTING_CHANGE_EVENT", {
        key: "integration",
        payload: { readwiseToken: "token" },
      })
      server.patch(USER, "ai", { personalizePrompt: "Call me Captain." })
      await pull()
      await sent()

      expect(server.requests).toEqual([])
      expect(settings("ai").personalizePrompt).toBe("")
    })
  })

  describe("sending", () => {
    it("still sends a change after the app was killed before it went out", async () => {
      change("general", "unreadOnly", true)

      launch()
      await sent()

      expect(server.tab("general")).toEqual({ unreadOnly: true })
    })

    it("still sends it when the app is killed again right after the restart", async () => {
      change("general", "unreadOnly", true)

      launch()
      launch()
      await sent()

      expect(server.tab("general")).toEqual({ unreadOnly: true })
    })

    it("still sends it when the sync engine reports its tab before the queue starts", async () => {
      change("general", "unreadOnly", true)
      server.patch(USER, "general", { dimRead: true })

      load()
      await pull()
      queue.init()
      await sent()

      expect(server.tab("general")).toEqual({ dimRead: true, unreadOnly: true })
    })

    it("does not send a change again after a restart once the server took it", async () => {
      change("general", "unreadOnly", true)
      await sent()

      launch()
      await sent()

      expect(server.requests).toHaveLength(1)
    })

    it("sends what changed while a request was on its way after it", async () => {
      let release!: () => void
      server.connection.hold = new Promise((resolve) => {
        release = resolve
      })
      change("general", "unreadOnly", true)
      change("general", "hoverMarkUnread", true)
      await sent()

      change("general", "unreadOnly", false)
      change("general", "dimRead", true)
      server.connection.hold = null
      release()
      await sent()

      expect(server.requests).toEqual([
        { tab: "general", body: { unreadOnly: true, hoverMarkUnread: true } },
        { tab: "general", body: { unreadOnly: false, dimRead: true } },
      ])
      expect(queue.getStatus()).toBe("synced")
    })

    it("retries a change that failed to send, waiting longer each time, until it goes through", async () => {
      server.connection.error = new TypeError("Failed to fetch")
      change("general", "unreadOnly", true)

      await vi.advanceTimersByTimeAsync(1000)
      expect(server.requests).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(server.requests).toHaveLength(2)
      // A change made while a retry waits goes out with it
      change("general", "dimRead", true)
      server.connection.error = null
      await vi.advanceTimersByTimeAsync(1999)
      expect(server.requests).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(server.tab("general")).toEqual({ unreadOnly: true, dimRead: true })

      await vi.advanceTimersByTimeAsync(120_000)
      expect(server.requests).toHaveLength(3)
    })

    it.each([
      ["the app says so", () => queue.resume()],
      ["the network comes back", () => window.dispatchEvent(new Event("online"))],
      ["the window gets the focus back", () => window.dispatchEvent(new Event("focus"))],
      ["the page becomes visible", () => document.dispatchEvent(new Event("visibilitychange"))],
    ])("sends a waiting change at once when %s, and reports its state", async (_, comeBack) => {
      const statuses = new Set<string>()
      queue.subscribe(() => statuses.add(queue.getStatus()))
      server.connection.error = new TypeError("Failed to fetch")
      change("general", "unreadOnly", true)
      // Failures at 1, 2, 4 and 8 s: the next try is eight seconds away
      await vi.advanceTimersByTimeAsync(8000)
      expect(server.requests).toHaveLength(4)
      expect(queue.getStatus()).toBe("failed")

      server.connection.error = null
      comeBack()
      await sent()

      expect(server.requests).toHaveLength(5)
      expect(queue.getStatus()).toBe("synced")
      expect(statuses).toEqual(new Set(["pending", "failed", "synced"]))
    })
  })

  describe("the account", () => {
    it("keeps a change through an expired session and sends it once the account is back", async () => {
      server.connection.error = new FollowAPIError("Unauthorized", 401)
      change("general", "unreadOnly", true)
      await sent()
      // Restarted on the way to signing in again
      signIn(null)
      launch()
      await sent()
      expect(server.requests).toHaveLength(1)

      server.connection.error = null
      signIn(USER)
      await sent()

      expect(server.tab("general")).toEqual({ unreadOnly: true })
    })

    it("sends nothing of one account as another, and takes the other's settings from scratch", async () => {
      server.patch("user-2", "general", { dimRead: true })
      // Taken here, and stamped later than anything of the other account
      server.patch(USER, "general", { dimRead: false })
      await pull()
      server.connection.error = new TypeError("Failed to fetch")
      change("general", "unreadOnly", true)
      await sent()

      server.connection.error = null
      signIn(null)
      signIn("user-2")
      await sent()
      await getSyncModelHandler("setting")!.bootstrap!()

      expect(server.requests).toEqual([expect.objectContaining({ tab: "general" }), { get: true }])
      expect(server.tab("general", "user-2")).toEqual({ dimRead: true })
      expect(settings("general").dimRead).toBe(true)
    })
  })
})
