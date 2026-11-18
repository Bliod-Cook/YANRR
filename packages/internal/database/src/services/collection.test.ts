import { describe, expect, it, vi } from "vitest"

import { db } from "../db"
import { collectionsTable } from "../schemas"
import { CollectionService } from "./collection"

vi.mock("../db", async () => (await import("../test-db")).createTestDB())

describe("CollectionService.upsertMany", () => {
  it("retains other views on a scoped reset", async () => {
    await db.insert(collectionsTable).values([
      { entryId: "article", view: 0 },
      { entryId: "video", view: 2 },
    ])

    await CollectionService.upsertMany([], { reset: true, view: 0 })

    expect(await db.query.collectionsTable.findMany({ columns: { entryId: true } })).toEqual([
      { entryId: "video" },
    ])
  })

  it("clears the stored collections on a reset with none", async () => {
    await db.insert(collectionsTable).values({ entryId: "entry", view: 0 })

    await CollectionService.upsertMany([], { reset: true })

    expect(await db.query.collectionsTable.findMany()).toEqual([])
  })
})
