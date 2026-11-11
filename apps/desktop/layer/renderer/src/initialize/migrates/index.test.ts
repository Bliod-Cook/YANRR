import { getStorageNS } from "@follow/utils/ns"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { doMigration } from "./index"

const migrate = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock("./v/v2", () => ({ v2: { version: "v2", migrate } }))

const versionKey = getStorageNS("migration_version")

describe("doMigration", () => {
  beforeEach(() => {
    localStorage.clear()
    migrate.mockReset()
  })

  test("runs a migration once and remembers its version", async () => {
    migrate.mockResolvedValue()

    await doMigration()
    await doMigration()

    expect(migrate).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(versionKey)!)).toEqual(["v2"])
  })

  test("rejects when a migration fails, and leaves it to run again", async () => {
    migrate.mockRejectedValueOnce(new Error("broken"))

    await expect(doMigration()).rejects.toThrow("broken")
    expect(localStorage.getItem(versionKey)).toBeNull()

    migrate.mockResolvedValue()
    await doMigration()
    expect(migrate).toHaveBeenCalledTimes(2)
  })
})
