import { db } from "@follow/database/db"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useEntryStore } from "../entry/store"
import { translationActions, translationSyncService } from "./store"
import type { TranslationMode } from "./types"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

const entryId = "entry-1"
const translationBatch = vi.fn()

const translate = (mode: TranslationMode) =>
  translationSyncService.generateTranslation({ entryId, language: "ja", target: "content", mode })

// Requests are sent together once a second
const sendRequests = () => vi.advanceTimersByTimeAsync(1000)

describe("translationSyncService.generateTranslation", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await translationActions.reset()
    useEntryStore.setState({
      data: {
        [entryId]: {
          id: entryId,
          guid: entryId,
          title: "The weather is nice today, so we went for a walk in the park",
          insertedAt: new Date(),
          publishedAt: new Date(),
        },
      },
    })
    apiContext.provide({ ai: { translationBatch } } as unknown as FollowAPI)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps the translations of one mode when another is asked for", async () => {
    translationBatch.mockImplementation(
      async ({ mode }: { mode: TranslationMode }) =>
        new Response(`${JSON.stringify({ id: entryId, data: { title: mode } })}\n`),
    )

    for (const mode of ["bilingual", "translation-only"] as const) {
      const translation = translate(mode)
      await sendRequests()
      await translation
    }

    expect(translationActions.getTranslation(entryId, "ja", "bilingual")?.title).toBe("bilingual")
    expect(translationActions.getTranslation(entryId, "ja", "translation-only")?.title).toBe(
      "translation-only",
    )
    const stored = await db.query.translationsTable.findMany()
    expect(stored.map(({ mode, title }) => [mode, title])).toEqual([
      ["bilingual", "bilingual"],
      ["translation-only", "translation-only"],
    ])
  })

  it("fails when the translation request fails", async () => {
    const error = new Error("Bad gateway")
    translationBatch.mockRejectedValue(error)

    const failed = expect(translate("bilingual")).rejects.toBe(error)
    await sendRequests()
    await failed
  })
})
