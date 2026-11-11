import { db } from "@follow/database/db"
import { summaryService } from "@follow/database/services/summary"
import { beforeEach, describe, expect, test, vi } from "vitest"

import type { FollowAPI } from "../../api-contract"
import { apiContext } from "../../context"
import { useEntryStore } from "../entry/store"
import type { EntryModel } from "../entry/types"
import { SummaryGeneratingStatus } from "./enum"
import { summarySyncService, useSummaryStore } from "./store"
import { getGenerateSummaryStatusId } from "./utils"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

const createEntry = (id: string): EntryModel => ({
  id,
  guid: `${id}-guid`,
  insertedAt: new Date("2026-01-01T00:00:00.000Z"),
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
})

describe("summarySyncService", () => {
  const entryId = "entry-1"
  const actionLanguage = "en"
  const target = "content"
  const summaryApiMock = vi.fn()
  const generate = () => summarySyncService.generateSummary({ entryId, target, actionLanguage })
  const status = () =>
    useSummaryStore.getState().generatingStatus[
      getGenerateSummaryStatusId(entryId, actionLanguage, target)
    ]

  beforeEach(async () => {
    vi.clearAllMocks()
    useSummaryStore.setState({ data: {}, generatingStatus: {} })
    await summaryService.reset()

    useEntryStore.setState({
      data: {
        [entryId]: createEntry(entryId),
      },
    })
    apiContext.provide({
      ai: {
        summary: summaryApiMock,
      },
    } as unknown as FollowAPI)
  })

  test("stores the summary", async () => {
    summaryApiMock.mockResolvedValue({ data: "A summary" })

    await expect(generate()).resolves.toBe("A summary")

    expect(await db.query.summariesTable.findMany()).toMatchObject([
      { entryId, language: actionLanguage, summary: "A summary" },
    ])
  })

  test.each([{ apiData: null }, { apiData: "" }])(
    "treats an empty summary as none: $apiData",
    async ({ apiData }) => {
      summaryApiMock.mockResolvedValue({ data: apiData })

      await expect(generate()).resolves.toBeNull()

      expect(await db.query.summariesTable.findMany()).toEqual([])
      expect(status()).toBe(SummaryGeneratingStatus.Success)
    },
  )

  test("marks the summary failed and passes the error on when the request fails", async () => {
    const error = new Error("Bad gateway")
    summaryApiMock.mockRejectedValue(error)

    await expect(generate()).rejects.toBe(error)

    expect(status()).toBe(SummaryGeneratingStatus.Error)
  })
})
