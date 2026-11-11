import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearLocalDataOfAnotherAccount } from "./clear"

const mocks = vi.hoisted(() => ({
  deleteDB: vi.fn(async () => {}),
  clearImageDimensionsDb: vi.fn(async () => {}),
  reloadAtAppRoot: vi.fn(),
}))

vi.mock("@follow/database/db", () => ({ deleteDB: mocks.deleteDB }))
vi.mock("../image/db", () => ({ clearImageDimensionsDb: mocks.clearImageDimensionsDb }))
vi.mock("~/lib/reload-at-app-root", () => ({ reloadAtAppRoot: mocks.reloadAtAppRoot }))

describe("clearLocalDataOfAnotherAccount", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("starts over without the settings of the account before", async () => {
    // Synced with the "ai" tab, so the next account's first sync would upload them
    localStorage.setItem(
      "follow:ai",
      JSON.stringify({
        byok: { enabled: true, providers: [{ provider: "openai", apiKey: "sk-a" }] },
      }),
    )
    localStorage.setItem("follow:integration", JSON.stringify({ readwiseToken: "token-a" }))
    localStorage.setItem("follow:REACT_QUERY_OFFLINE_CACHE", "{}")
    localStorage.setItem("another-app", "kept")

    await clearLocalDataOfAnotherAccount()

    expect(mocks.deleteDB).toHaveBeenCalledTimes(1)
    expect(mocks.clearImageDimensionsDb).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("follow:ai")).toBeNull()
    expect(localStorage.getItem("follow:integration")).toBeNull()
    expect(localStorage.getItem("follow:REACT_QUERY_OFFLINE_CACHE")).toBeNull()
    expect(localStorage.getItem("another-app")).toBe("kept")
    // Not on the page the account before had open
    expect(mocks.reloadAtAppRoot).toHaveBeenCalledTimes(1)
  })
})
