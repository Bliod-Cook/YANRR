import { beforeEach, describe, expect, it, vi } from "vitest"

import { applyCacheSizeLimit } from "./cache"

const mocks = vi.hoisted(() => ({
  appendSwitch: vi.fn(),
  cacheSizeLimit: undefined as number | undefined,
}))

vi.mock("electron", () => ({ app: { commandLine: { appendSwitch: mocks.appendSwitch } } }))
vi.mock("./store", () => ({
  store: { get: (key: string) => (key === "cacheSizeLimit" ? mocks.cacheSizeLimit : undefined) },
  StoreKey: { CacheSizeLimit: "cacheSizeLimit" },
}))

describe("applyCacheSizeLimit", () => {
  beforeEach(() => {
    mocks.appendSwitch.mockClear()
  })

  it("has Chromium keep its cache within the limit the user set in megabytes", () => {
    mocks.cacheSizeLimit = 300

    applyCacheSizeLimit()

    expect(mocks.appendSwitch).toHaveBeenCalledWith("disk-cache-size", String(300 * 1024 * 1024))
  })

  it("leaves the size to Chromium without a limit", () => {
    mocks.cacheSizeLimit = undefined

    applyCacheSizeLimit()

    expect(mocks.appendSwitch).not.toHaveBeenCalled()
  })
})
