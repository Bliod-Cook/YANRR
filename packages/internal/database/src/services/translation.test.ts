import { describe, expect, it, vi } from "vitest"

import { db } from "../db"
import { translationsTable } from "../schemas"
import { TranslationService } from "./translation"

vi.mock("../db", async () => (await import("../test-db")).createTestDB())

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

describe("TranslationService.getTranslationToHydrate", () => {
  it("deletes the translations older than a week and returns the others", async () => {
    const translation = { entryId: "entry", language: "en", mode: "bilingual" } as const
    await db.insert(translationsTable).values([
      { ...translation, title: "Old", createdAt: daysAgo(8) },
      { ...translation, language: "ja", title: "Fresh", createdAt: daysAgo(1) },
    ])

    const kept = await TranslationService.getTranslationToHydrate()

    expect(kept.map((row) => row.title)).toEqual(["Fresh"])
    expect(await db.query.translationsTable.findMany()).toEqual(kept)
  })
})
