import { beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => {
  // What the system keeps of registered tasks across launches
  const registered = new Map<string, { minimumInterval?: number }>()
  return {
    registered,
    defineTask: vi.fn(),
    registerTaskAsync: vi.fn(async (name: string, options: { minimumInterval?: number }) => {
      // Like the real one, registering a registered task changes nothing
      if (!registered.has(name)) registered.set(name, options)
    }),
    unregisterTaskAsync: vi.fn(async (name: string) => {
      registered.delete(name)
    }),
  }
})

vi.mock("expo-background-task", () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  registerTaskAsync: native.registerTaskAsync,
  unregisterTaskAsync: native.unregisterTaskAsync,
}))

vi.mock("expo-task-manager", () => ({
  defineTask: native.defineTask,
  getTaskOptionsAsync: async (name: string) => native.registered.get(name) ?? null,
}))

const store = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  user: { id: "user" } as { id: string } | null,
  badge: true,
}))
vi.mock("@follow/store/unread/getters", () => ({ getUnreadAll: () => 3 }))
vi.mock("@follow/store/unread/store", () => ({ unreadSyncService: { refresh: store.refresh } }))
vi.mock("@follow/store/user/getters", () => ({ whoami: () => store.user }))
vi.mock("../atoms/settings/ui", () => ({
  getUISettings: () => ({ showUnreadCountBadgeMobile: store.badge }),
}))
vi.mock("../lib/permission", () => ({ setBadgeCountAsyncWithPermission: vi.fn() }))

const { setBackgroundTaskEnabled } = await import("./background")
const { setStartupReady } = await import("./startup")
const runTask = native.defineTask.mock.calls[0]![1] as () => Promise<number>

describe("setBackgroundTaskEnabled", () => {
  beforeEach(() => {
    native.registered.clear()
    native.registerTaskAsync.mockClear()
    native.unregisterTaskAsync.mockClear()
  })

  it("asks to run every 15 minutes", async () => {
    await setBackgroundTaskEnabled(true)

    expect(native.registered.get("background-fetch")).toEqual({ minimumInterval: 15 })
  })

  it("replaces a task an older version registered every 900 minutes", async () => {
    native.registered.set("background-fetch", { minimumInterval: 900 })

    await setBackgroundTaskEnabled(true)

    expect(native.registered.get("background-fetch")).toEqual({ minimumInterval: 15 })
  })

  it("leaves a task registered every 15 minutes alone", async () => {
    native.registered.set("background-fetch", { minimumInterval: 15 })

    await setBackgroundTaskEnabled(true)

    expect(native.unregisterTaskAsync).not.toHaveBeenCalled()
  })

  it("removes a registered task when the badge is off, and registers none", async () => {
    native.registered.set("background-fetch", { minimumInterval: 15 })

    await setBackgroundTaskEnabled(false)
    expect(native.registered.has("background-fetch")).toBe(false)

    await setBackgroundTaskEnabled(false)
    expect(native.registerTaskAsync).not.toHaveBeenCalled()
  })
})

describe("the background task", () => {
  it("waits for the startup before it reads the session", async () => {
    let finished = false
    const run = runTask().then((result) => {
      finished = true
      return result
    })
    await Promise.resolve()
    expect(store.refresh).not.toHaveBeenCalled()
    expect(finished).toBe(false)

    setStartupReady()

    await expect(run).resolves.toBe(1)
    expect(store.refresh).toHaveBeenCalledOnce()
  })
})
