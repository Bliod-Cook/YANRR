import { apiContext } from "@follow/store/context"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PUSH_TOKEN_STORAGE_KEY, registerPushToken, unregisterPushToken } from "./push-token"

const kvStore = new Map<string, string>()

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }))
vi.mock("./kv", () => ({
  kv: {
    getSync: (key: string) => kvStore.get(key) ?? null,
    set: (key: string, value: string) => void kvStore.set(key, value),
    delete: async (key: string) => void kvStore.delete(key),
  },
}))

const createToken = vi.fn()
const deleteToken = vi.fn()

beforeEach(() => {
  kvStore.clear()
  createToken.mockReset().mockResolvedValue({ code: 0 })
  deleteToken.mockReset()
  apiContext.provide({ messaging: { createToken, deleteToken } } as unknown as Parameters<
    typeof apiContext.provide
  >[0])
})

describe("registerPushToken", () => {
  it("registers a token once for an account, not on every start", async () => {
    await registerPushToken("user-1", "token-1")
    await registerPushToken("user-1", "token-1")

    expect(createToken).toHaveBeenCalledOnce()
    expect(createToken).toHaveBeenCalledWith({ token: "token-1", channel: "ios" })
  })

  it("registers again when the token or the account changed", async () => {
    await registerPushToken("user-1", "token-1")
    await registerPushToken("user-1", "token-2")
    await registerPushToken("user-2", "token-2")

    expect(createToken).toHaveBeenCalledTimes(3)
  })

  it("tries again after a failed registration", async () => {
    createToken.mockRejectedValueOnce(new Error("offline"))
    await expect(registerPushToken("user-1", "token-1")).rejects.toThrow("offline")

    await registerPushToken("user-1", "token-1")

    expect(createToken).toHaveBeenCalledTimes(2)
  })
})

describe("unregisterPushToken", () => {
  it("asks the server to forget this device's token, without waiting long", async () => {
    await registerPushToken("user-1", "device-token")
    deleteToken.mockResolvedValue({ code: 0 })

    await unregisterPushToken()

    expect(deleteToken).toHaveBeenCalledWith({ token: "device-token" }, { timeout: 5000 })
    expect(kvStore.has(PUSH_TOKEN_STORAGE_KEY)).toBe(false)
  })

  it("forgets a token stored bare, as versions before kept it", async () => {
    kvStore.set(PUSH_TOKEN_STORAGE_KEY, "legacy-token")
    deleteToken.mockResolvedValue({ code: 0 })

    await unregisterPushToken()

    expect(deleteToken).toHaveBeenCalledWith({ token: "legacy-token" }, { timeout: 5000 })
    expect(kvStore.has(PUSH_TOKEN_STORAGE_KEY)).toBe(false)
  })

  it("removes nothing when this device never registered a token", async () => {
    await unregisterPushToken()

    expect(deleteToken).not.toHaveBeenCalled()
  })

  it("lets the sign-out go on when the server cannot be reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await registerPushToken("user-1", "device-token")
    deleteToken.mockRejectedValue(new Error("fetch failed: offline"))

    await expect(unregisterPushToken()).resolves.toBeUndefined()
    // Still registered on the server, so a later sign-out asks again
    expect(kvStore.has(PUSH_TOKEN_STORAGE_KEY)).toBe(true)
  })
})
