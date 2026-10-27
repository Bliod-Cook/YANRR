import { FollowAPIError } from "@follow-app/client-sdk"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { aiEnabledContext, apiContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useEntryStore } from "../entry/store"
import type { EntryModel } from "../entry/types"
import { SummaryGeneratingStatus } from "./enum"
import { summarySyncService, useSummaryStore } from "./store"
import { getGenerateSummaryStatusId } from "./utils"

const { insertSummaryMock } = vi.hoisted(() => ({
  insertSummaryMock: vi.fn(),
}))

vi.mock("@follow/database/services/summary", () => ({
  summaryService: {
    getAllSummaries: vi.fn(),
    insertSummary: insertSummaryMock,
    reset: vi.fn(),
  },
}))

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

  beforeEach(() => {
    vi.clearAllMocks()

    useEntryStore.setState({
      data: {
        [entryId]: createEntry(entryId),
      },
    })
    useSummaryStore.setState({
      data: {},
      generatingStatus: {},
    })
    aiEnabledContext.provide(() => true)
    apiContext.provide({
      ai: {
        summary: summaryApiMock,
      },
    } as unknown as FollowAPI)
  })

  test.each([
    { apiData: null, expected: null },
    { apiData: "", expected: null },
  ])(
    "treats empty API summary data as unavailable instead of payment failure",
    async ({ apiData, expected }) => {
      summaryApiMock.mockResolvedValue({ data: apiData })

      await expect(
        summarySyncService.generateSummary({
          entryId,
          target,
          actionLanguage,
        }),
      ).resolves.toBe(expected)

      expect(insertSummaryMock).not.toHaveBeenCalled()
      expect(
        useSummaryStore.getState().generatingStatus[
          getGenerateSummaryStatusId(entryId, actionLanguage, target)
        ],
      ).toBe(SummaryGeneratingStatus.Success)
    },
  )

  test("keeps real API payment errors for the upgrade prompt", async () => {
    const paymentError = new FollowAPIError("Payment required", 402)
    summaryApiMock.mockRejectedValue(paymentError)

    await expect(
      summarySyncService.generateSummary({
        entryId,
        target,
        actionLanguage,
      }),
    ).rejects.toBe(paymentError)

    expect(
      useSummaryStore.getState().generatingStatus[
        getGenerateSummaryStatusId(entryId, actionLanguage, target)
      ],
    ).toBe(SummaryGeneratingStatus.Error)
  })
})

describe("summarySyncService while the server has AI off", () => {
  test("asks for nothing", async () => {
    const summaryApiMock = vi.fn()
    useEntryStore.setState({ data: { "entry-1": createEntry("entry-1") } })
    apiContext.provide({ ai: { summary: summaryApiMock } } as unknown as FollowAPI)
    aiEnabledContext.provide(() => false)

    await expect(
      summarySyncService.generateSummary({
        entryId: "entry-1",
        target: "content",
        actionLanguage: "en",
      }),
    ).resolves.toBeNull()
    expect(summaryApiMock).not.toHaveBeenCalled()
  })
})
