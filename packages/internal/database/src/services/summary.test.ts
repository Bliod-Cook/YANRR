import { describe, expect, it, vi } from "vitest"

import { db } from "../db"
import { entriesTable, summariesTable } from "../schemas"
import { summaryService } from "./summary"

vi.mock("../db", async () => (await import("../test-db")).createTestDB())

describe("summaryService.getSummariesToHydrate", () => {
  it("deletes the summaries of entries that are no longer stored", async () => {
    await db
      .insert(entriesTable)
      .values({ id: "kept", guid: "kept", insertedAt: new Date(), publishedAt: new Date() })
    await db.insert(summariesTable).values([
      { entryId: "kept", language: "en", summary: "Kept" },
      { entryId: "pruned", language: "en", summary: "Pruned" },
    ])

    const summaries = await summaryService.getSummariesToHydrate()

    expect(summaries.map((row) => row.summary)).toEqual(["Kept"])
    expect(await db.query.summariesTable.findMany()).toEqual(summaries)
  })
})
