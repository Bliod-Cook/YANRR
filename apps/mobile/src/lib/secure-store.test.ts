import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  ;(globalThis as { __DEV__?: boolean }).__DEV__ = false
  return {
    keychain: new Map<string, string>(),
    plainText: new Map<string, string>(),
    // The keychain refuses access, as before the first unlock or without the entitlement
    locked: false,
    e2eBuild: false,
  }
})

const keychainError = () =>
  new Error("KeyChainException: Could not access the keychain: User interaction is not allowed.")

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 0,
  getItem: vi.fn((key: string) => {
    if (mocks.locked) throw keychainError()
    return mocks.keychain.get(key) ?? null
  }),
  setItem: vi.fn((key: string, value: string) => {
    if (mocks.locked) throw keychainError()
    mocks.keychain.set(key, value)
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    mocks.keychain.delete(key)
  }),
}))
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => mocks.plainText.get(key) ?? null,
    setItemSync: (key: string, value: string) => void mocks.plainText.set(key, value),
    removeItemSync: (key: string) => void mocks.plainText.delete(key),
  },
}))
vi.mock("./e2e-config", () => ({ isE2EBuild: () => mocks.e2eBuild }))

const SecureStore = await import("expo-secure-store")

const loadSecureStore = async () => {
  vi.resetModules()
  return (await import("./secure-store")).safeSecureStore
}

describe("safeSecureStore", () => {
  beforeEach(() => {
    mocks.keychain.clear()
    mocks.plainText.clear()
    mocks.locked = false
    mocks.e2eBuild = false
    vi.mocked(SecureStore.getItem).mockClear()
  })

  it("reads each value from the keychain once", async () => {
    mocks.keychain.set("follow_auth_cookie", "cookie")
    const store = await loadSecureStore()

    expect(store.getItem("follow_auth_cookie")).toBe("cookie")
    expect(store.getItem("follow_auth_cookie")).toBe("cookie")
    store.setItem("follow_auth_cookie", "next cookie")
    expect(store.getItem("follow_auth_cookie")).toBe("next cookie")
    await store.removeItemAsync("follow_auth_cookie")
    expect(store.getItem("follow_auth_cookie")).toBeNull()

    expect(SecureStore.getItem).toHaveBeenCalledTimes(2)
  })

  it("fails a read the keychain refused instead of reporting no value, and reads again later", async () => {
    mocks.keychain.set("follow_auth_cookie", "cookie")
    const store = await loadSecureStore()

    mocks.locked = true
    expect(() => store.getItem("follow_auth_cookie")).toThrow()

    mocks.locked = false
    expect(store.getItem("follow_auth_cookie")).toBe("cookie")
  })

  it("keeps values readable while the device is locked after its first unlock", async () => {
    const store = await loadSecureStore()

    store.setItem("follow_auth_cookie", "cookie")

    expect(SecureStore.setItem).toHaveBeenCalledWith("follow_auth_cookie", "cookie", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    })
  })

  it("never keeps a value in plain text in a release build", async () => {
    mocks.locked = true
    const store = await loadSecureStore()

    expect(() => store.setItem("follow_auth_cookie", "cookie")).toThrow()
    expect(mocks.plainText.size).toBe(0)
  })

  it("keeps values in plain text in an E2E build without keychain access", async () => {
    mocks.locked = true
    mocks.e2eBuild = true
    const store = await loadSecureStore()

    store.setItem("follow_auth_cookie", "cookie")

    expect(store.getItem("follow_auth_cookie")).toBe("cookie")
    expect([...mocks.plainText.values()]).toEqual(["cookie"])
  })
})
