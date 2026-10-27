import { beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => {
  // What the system keeps of registered tasks across launches
  const registered = new Map<string, { minimumInterval?: number }>()
  return {
    registered,
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
  defineTask: vi.fn(),
  getTaskOptionsAsync: async (name: string) => native.registered.get(name) ?? null,
}))

vi.mock("@follow/store/unread/getters", () => ({ getUnreadAll: vi.fn() }))
vi.mock("@follow/store/unread/store", () => ({ unreadSyncService: {} }))
vi.mock("@follow/store/user/getters", () => ({ whoami: vi.fn() }))
vi.mock("../atoms/settings/ui", () => ({ getUISettings: vi.fn() }))
vi.mock("../lib/permission", () => ({ setBadgeCountAsyncWithPermission: vi.fn() }))

const { initBackgroundTask } = await import("./background")

describe("initBackgroundTask", () => {
  beforeEach(() => {
    native.registered.clear()
  })

  it("asks to run every 15 minutes", async () => {
    await initBackgroundTask()

    expect(native.registered.get("background-fetch")).toEqual({ minimumInterval: 15 })
  })

  it("replaces a task an older version registered every 900 minutes", async () => {
    native.registered.set("background-fetch", { minimumInterval: 900 })

    await initBackgroundTask()

    expect(native.registered.get("background-fetch")).toEqual({ minimumInterval: 15 })
  })

  it("leaves a task registered every 15 minutes alone", async () => {
    native.registered.set("background-fetch", { minimumInterval: 15 })

    await initBackgroundTask()

    expect(native.unregisterTaskAsync).not.toHaveBeenCalled()
  })
})
