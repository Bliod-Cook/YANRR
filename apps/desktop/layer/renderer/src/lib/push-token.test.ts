import { apiContext } from "@follow/store/context"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { registerPushToken, unregisterPushToken } from "./push-token"

const mocks = vi.hoisted(() => ({
  createToken: vi.fn(),
  deleteToken: vi.fn(),
  getMessagingToken: vi.fn(),
}))

// The main process, which receives the token from the push service
vi.mock("./client", () => ({
  ipcServices: { setting: { getMessagingToken: mocks.getMessagingToken } },
}))

describe("push token", () => {
  beforeEach(() => {
    localStorage.clear()
    window.platform = "win32"
    mocks.createToken.mockReset().mockResolvedValue({ code: 0 })
    mocks.deleteToken.mockReset().mockResolvedValue({ code: 0 })
    mocks.getMessagingToken.mockReset().mockResolvedValue("device-token")
    apiContext.provide({
      messaging: { createToken: mocks.createToken, deleteToken: mocks.deleteToken },
    } as unknown as Parameters<typeof apiContext.provide>[0])
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("registers the device's token for the user once, not at every launch", async () => {
    await registerPushToken("user-1")
    await registerPushToken("user-1")

    expect(mocks.createToken).toHaveBeenCalledOnce()
    expect(mocks.createToken).toHaveBeenCalledWith({ token: "device-token", channel: "windows" })
  })

  it("registers the token again for another user", async () => {
    await registerPushToken("user-1")
    await registerPushToken("user-2")

    expect(mocks.createToken).toHaveBeenCalledTimes(2)
  })

  it("tries again at the next chance after a failed registration", async () => {
    mocks.createToken.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    await expect(registerPushToken("user-1")).rejects.toThrow()
    await registerPushToken("user-1")

    expect(mocks.createToken).toHaveBeenCalledTimes(2)
  })

  it("waits for the push service to register the device", async () => {
    mocks.getMessagingToken.mockResolvedValue(null)

    await registerPushToken("user-1")

    expect(mocks.createToken).not.toHaveBeenCalled()
  })

  it("takes this device's token, and no other, off the account signing out", async () => {
    await registerPushToken("user-1")

    await unregisterPushToken()
    await registerPushToken("user-1")

    expect(mocks.deleteToken).toHaveBeenCalledWith({ token: "device-token" }, expect.anything())
    // Signed in again, the device registers again
    expect(mocks.createToken).toHaveBeenCalledTimes(2)
  })
})
