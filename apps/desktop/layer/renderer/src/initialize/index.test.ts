import i18next from "i18next"
import { describe, expect, test, vi } from "vitest"

import { initializeApp } from "./index"

vi.mock("@follow/store/hydrate", () => ({
  hydrateDatabaseToStore: () => Promise.reject(new Error("The quota has been exceeded.")),
}))

describe("initializeApp", () => {
  test("sets up what does not need the local database before that fails to open", async () => {
    localStorage.setItem("follow:auth_session_token", "kept-by-an-older-version")

    await expect(initializeApp()).rejects.toThrow("The quota has been exceeded.")

    // The session is a cookie that scripts cannot read; no copy of its token stays behind
    expect(localStorage.getItem("follow:auth_session_token")).toBeNull()

    // The screen telling of the failure is translated
    expect(i18next.isInitialized).toBe(true)
  })
})
