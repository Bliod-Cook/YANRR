import { lt } from "drizzle-orm"

import { db } from "../db"
import { translationsTable } from "../schemas"
import type { TranslationSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"

const TRANSLATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

class TranslationServiceStatic implements Resetable {
  /** The translations of the last week; older ones are deleted */
  async getTranslationToHydrate() {
    const expiredBefore = new Date(Date.now() - TRANSLATION_LIFETIME_MS).toISOString()
    await db.delete(translationsTable).where(lt(translationsTable.createdAt, expiredBefore))
    return db.query.translationsTable.findMany()
  }

  async reset() {
    await db.delete(translationsTable).execute()
  }

  async insertTranslation(data: Omit<TranslationSchema, "createdAt">) {
    const updateExceptEmpty = Object.fromEntries(
      Object.entries({
        title: data.title,
        description: data.description,
        content: data.content,
        readabilityContent: data.readabilityContent,
      }).filter(([_, value]) => !!value),
    )

    await db
      .insert(translationsTable)
      .values({
        ...data,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [translationsTable.entryId, translationsTable.language, translationsTable.mode],
        set: updateExceptEmpty,
      })
  }
}

export const TranslationService = new TranslationServiceStatic()
