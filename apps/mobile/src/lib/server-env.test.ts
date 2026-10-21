import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./jotai", () => {
  const storage = new Map<string, unknown>()
  return {
    JotaiPersistSyncStorage: {
      getItem: <Value>(key: string, defaultValue: Value) =>
        (storage.has(key) ? storage.get(key) : defaultValue) as Value,
      setItem: (key: string, value: unknown) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
      subscribe: () => () => {},
    },
  }
})

describe("server address", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is the one built into the app, which the user cannot change", async () => {
    vi.stubEnv("EXPO_PUBLIC_YANNR_SERVER_URL", "https://rss.example.com/")
    const { getServerUrl, isServerUrlBuiltIn, saveServerUrl } = await import("./server-env")

    saveServerUrl("https://other.example.com")

    expect(getServerUrl()).toBe("https://rss.example.com")
    expect(isServerUrlBuiltIn).toBe(true)
  })

  it("is the one the user enters when the app comes without one", async () => {
    vi.stubEnv("EXPO_PUBLIC_YANNR_SERVER_URL", "")
    const { getServerUrl, isServerUrlBuiltIn, saveServerUrl } = await import("./server-env")

    saveServerUrl("https://other.example.com")

    expect(getServerUrl()).toBe("https://other.example.com")
    expect(isServerUrlBuiltIn).toBe(false)
  })
})
