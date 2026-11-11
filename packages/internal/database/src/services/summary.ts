import { notInArray } from "drizzle-orm"

import { db } from "../db"
import { entriesTable, summariesTable } from "../schemas"
import type { SummarySchema } from "../schemas/types"
import type { Resetable } from "./internal/base"

class SummaryServiceStatic implements Resetable {
  async reset() {
    await db.delete(summariesTable)
  }

  async insertSummary(data: Omit<SummarySchema, "createdAt">) {
    const updateExceptEmpty = Object.fromEntries(
      Object.entries({
        summary: data.summary,
        readabilitySummary: data.readabilitySummary,
      }).filter(([_, value]) => !!value),
    )

    await db
      .insert(summariesTable)
      .values({
        ...data,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [summariesTable.entryId, summariesTable.language],
        set: updateExceptEmpty,
      })
  }

  /** The summaries of the stored entries; those of entries no longer stored are deleted */
  async getSummariesToHydrate() {
    await db
      .delete(summariesTable)
      .where(
        notInArray(summariesTable.entryId, db.select({ id: entriesTable.id }).from(entriesTable)),
      )
    return db.query.summariesTable.findMany()
  }
}

export const summaryService = new SummaryServiceStatic()
