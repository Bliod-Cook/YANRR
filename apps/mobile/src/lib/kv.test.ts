import { expect, it, vi } from "vitest"

const writeError = new Error("database is locked")
vi.mock("expo-sqlite/kv-store", () => ({
  default: { setItem: async () => Promise.reject(writeError) },
}))

const { kv } = await import("./kv")

it("lets the caller wait for a write and see it fail", async () => {
  await expect(kv.set("key", "value")).rejects.toBe(writeError)
})
