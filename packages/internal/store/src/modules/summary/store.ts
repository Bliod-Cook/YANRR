import type { SummarySchema } from "@follow/database/schemas/types"
import { summaryService } from "@follow/database/services/summary"
import type { SupportedActionLanguage } from "@follow/shared"
import { toApiSupportedActionLanguage } from "@follow/shared"

import { api } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { getEntry } from "../entry/getter"
import { SummaryGeneratingStatus } from "./enum"
import type { StatusID } from "./utils"
import { getGenerateSummaryStatusId } from "./utils"

type SummaryModel = Omit<SummarySchema, "createdAt">

interface SummaryData {
  summary: string
  readabilitySummary: string | null
}

interface SummaryState {
  /**
   * Key: entryId
   * Value: language -> SummaryData
   */
  data: Record<string, Partial<Record<SupportedActionLanguage, SummaryData>>>

  generatingStatus: Record<StatusID, SummaryGeneratingStatus>
}
const emptyDataSet: Record<string, Partial<Record<SupportedActionLanguage, SummaryData>>> = {}

export const useSummaryStore = createZustandStore<SummaryState>("summary")(() => ({
  data: emptyDataSet,
  generatingStatus: {},
}))

const get = useSummaryStore.getState
const set = useSummaryStore.setState
const immerSet = createImmerSetter(useSummaryStore)
class SummaryActions implements Resetable, Hydratable {
  async hydrate() {
    const summaries = await summaryService.getSummariesToHydrate()
    this.upsertManyInSession(summaries)
  }

  upsertManyInSession(summaries: SummaryModel[]) {
    immerSet((state) => {
      summaries.forEach((summary) => {
        const byLanguage = (state.data[summary.entryId] ??= {})
        const current = byLanguage[summary.language]
        byLanguage[summary.language] = {
          summary: summary.summary || current?.summary || "",
          readabilitySummary: summary.readabilitySummary || current?.readabilitySummary || null,
        }
      })
    })
  }

  async upsertMany(summaries: SummaryModel[]) {
    this.upsertManyInSession(summaries)

    await Promise.all(summaries.map((summary) => summaryService.insertSummary(summary)))
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set({
        data: emptyDataSet,
        generatingStatus: {},
      })
    })
    tx.persist(() => summaryService.reset())

    await tx.run()
  }
}

export const summaryActions = new SummaryActions()

class SummarySyncService {
  private pendingPromises: Record<StatusID, Promise<string | null>> = {}

  async generateSummary({
    entryId,
    target,
    actionLanguage,
  }: {
    entryId: string
    target: "content" | "readabilityContent"
    actionLanguage: SupportedActionLanguage
  }): Promise<string | null> {
    const entry = getEntry(entryId)
    if (!entry) return null

    const state = get()
    const existing =
      state.data[entryId]?.[actionLanguage]?.[
        target === "content" ? "summary" : "readabilitySummary"
      ]
    if (existing) {
      return existing
    }

    const statusID = getGenerateSummaryStatusId(entryId, actionLanguage, target)
    if (state.generatingStatus[statusID] === SummaryGeneratingStatus.Pending)
      return this.pendingPromises[statusID] || null

    immerSet((state) => {
      state.generatingStatus[statusID] = SummaryGeneratingStatus.Pending
    })

    // Use Our AI to generate summary
    const pendingPromise = api()
      .ai.summary({
        id: entryId,
        language: toApiSupportedActionLanguage(actionLanguage),
        target,
      })
      .then((summary) => {
        const generatedSummary = summary.data?.trim() ? summary.data : null

        if (!generatedSummary) {
          immerSet((state) => {
            state.generatingStatus[statusID] = SummaryGeneratingStatus.Success
          })

          return null
        }

        immerSet((state) => {
          if (!state.data[entryId]) {
            state.data[entryId] = {}
          }

          state.data[entryId][actionLanguage] = {
            summary:
              target === "content"
                ? generatedSummary
                : state.data[entryId]?.[actionLanguage]?.summary || "",
            readabilitySummary:
              target === "readabilityContent"
                ? generatedSummary
                : state.data[entryId]?.[actionLanguage]?.readabilitySummary || null,
          }
          state.generatingStatus[statusID] = SummaryGeneratingStatus.Success
        })

        return generatedSummary
      })
      .catch((error) => {
        immerSet((state) => {
          state.generatingStatus[statusID] = SummaryGeneratingStatus.Error
        })

        throw error
      })
      .finally(() => {
        delete this.pendingPromises[statusID]
      })

    this.pendingPromises[statusID] = pendingPromise
    const summary = await pendingPromise

    if (summary) {
      await summaryActions.upsertMany([
        {
          entryId,
          summary: target === "content" ? summary : "",
          language: actionLanguage,
          readabilitySummary: target === "readabilityContent" ? summary : null,
        },
      ])
    }

    return summary
  }
}

export const summarySyncService = new SummarySyncService()
