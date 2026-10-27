import { describe, expect, test, vi } from "vitest"

import { aiEnabledContext, apiContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useEntryStore } from "../entry/store"
import { translationSyncService } from "./store"

vi.mock("@follow/database/services/translation", () => ({
  TranslationService: { getTranslationAll: vi.fn(), insertTranslation: vi.fn(), reset: vi.fn() },
}))

describe("translationSyncService while the server has AI off", () => {
  test("asks for nothing, even for an entry whose rules translate it", async () => {
    const translationBatch = vi.fn()
    apiContext.provide({ ai: { translationBatch } } as unknown as FollowAPI)
    aiEnabledContext.provide(() => false)
    useEntryStore.setState({
      data: {
        "entry-1": {
          id: "entry-1",
          guid: "entry-1",
          title: "Bonjour le monde",
          insertedAt: new Date(),
          publishedAt: new Date(),
          settings: { translation: "en" },
        },
      },
    })

    await expect(
      translationSyncService.generateTranslation({
        entryId: "entry-1",
        language: "en",
        target: "content",
      }),
    ).resolves.toBeNull()
    expect(translationBatch).not.toHaveBeenCalled()
  })
})
