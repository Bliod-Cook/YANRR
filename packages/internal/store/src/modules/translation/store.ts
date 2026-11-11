import type { TranslationSchema } from "@follow/database/schemas/types"
import { TranslationService } from "@follow/database/services/translation"
import type { SupportedActionLanguage } from "@follow/shared"
import { toApiSupportedActionLanguage } from "@follow/shared"
import { checkLanguage } from "@follow/utils/language"
import { create, indexedResolver, windowScheduler } from "@yornaath/batshit"

import { api } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { readNdjsonStream } from "../../lib/stream"
import { getEntry } from "../entry/getter"
import type { EntryTranslation, TranslationFieldArray, TranslationMode } from "./types"
import { translationFields } from "./types"

type TranslationModel = Omit<TranslationSchema, "createdAt">
type TranslationBatchRequest = Parameters<ReturnType<typeof api>["ai"]["translationBatch"]>[0]

interface TranslationState {
  /** Translations by entry id, language and mode */
  data: Record<
    string,
    Partial<Record<SupportedActionLanguage, Partial<Record<TranslationMode, EntryTranslation>>>>
  >
}
const defaultState: TranslationState = {
  data: {},
}

export const useTranslationStore = createZustandStore<TranslationState>("translation")(
  () => defaultState,
)

const get = useTranslationStore.getState
const set = useTranslationStore.setState
const immerSet = createImmerSetter(useTranslationStore)

class TranslationActions implements Hydratable, Resetable {
  async hydrate() {
    const translations = await TranslationService.getTranslationToHydrate()
    translationActions.upsertManyInSession(translations)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => TranslationService.reset())

    await tx.run()
  }

  upsertManyInSession(translations: TranslationModel[]) {
    immerSet((state) => {
      translations.forEach(({ entryId, language, mode, ...fields }) => {
        const byLanguage = (state.data[entryId] ??= {})
        const byMode = (byLanguage[language] ??= {})
        const translation = (byMode[mode] ??= {
          title: null,
          description: null,
          content: null,
          readabilityContent: null,
        })

        translationFields.forEach((field) => {
          if (fields[field]) {
            translation[field] = fields[field]
          }
        })
      })
    })
  }

  async upsertMany(translations: TranslationModel[]) {
    this.upsertManyInSession(translations)

    await Promise.all(
      translations.map((translation) => TranslationService.insertTranslation(translation)),
    )
  }

  getTranslation(entryId: string, language: SupportedActionLanguage, mode: TranslationMode) {
    return get().data[entryId]?.[language]?.[mode]
  }
}

export const translationActions = new TranslationActions()

type TranslationTarget = "content" | "readabilityContent"

class TranslationSyncService {
  private translationBatcher = create({
    fetcher: async (keys: string[]) => {
      // key format: `${entryId}|${language}|${target}|${fields}|${mode}`
      type KeyParts = {
        entryId: string
        language: SupportedActionLanguage
        target: TranslationTarget
        fields: string
        mode: TranslationMode
      }

      const parseKey = (key: string): KeyParts => {
        const [entryId, language, target, fields, mode] = key.split("|") as [
          string,
          SupportedActionLanguage,
          TranslationTarget,
          string,
          TranslationMode,
        ]
        return { entryId, language, target, fields, mode }
      }

      const requests = keys.map(parseKey)

      // Group by language + fields + mode to minimize stream calls
      const groupKey = (r: KeyParts) => `${r.language}#${r.fields}#${r.mode}`
      const grouped = new Map<
        string,
        {
          language: SupportedActionLanguage
          fields: string
          mode: TranslationMode
          ids: string[]
          keyById: Record<string, string>
        }
      >()

      for (const r of requests) {
        const gk = groupKey(r)
        if (!grouped.has(gk)) {
          grouped.set(gk, {
            language: r.language,
            fields: r.fields,
            mode: r.mode,
            ids: [],
            keyById: {},
          })
        }
        const g = grouped.get(gk)!
        g.ids.push(r.entryId)
        g.keyById[r.entryId] = `${r.entryId}|${r.language}|${r.target}|${r.fields}|${r.mode}`
      }

      const results: Record<string, TranslationModel | null> = {}

      // Execute each group sequentially to keep memory small; groups are already windowed by scheduler
      for (const [, group] of grouped) {
        const request: TranslationBatchRequest & { mode: TranslationMode } = {
          ids: group.ids,
          language: toApiSupportedActionLanguage(group.language),
          fields: group.fields,
          mode: group.mode,
        }
        const response = await api().ai.translationBatch(request)

        await readNdjsonStream<{
          id: string
          data: Partial<Record<keyof TranslationModel, string>>
        }>(response, async (json) => {
          const key = group.keyById[json.id]
          if (!key) return

          const translation: TranslationModel = {
            entryId: json.id,
            language: group.language,
            mode: group.mode,
            title: null,
            description: null,
            content: null,
            readabilityContent: null,
          }

          const { title, description, content, readabilityContent } = json.data || {}
          if (typeof title === "string") translation.title = title
          if (typeof description === "string") translation.description = description
          if (typeof content === "string") translation.content = content
          if (typeof readabilityContent === "string")
            translation.readabilityContent = readabilityContent

          results[key] = translation
          await translationActions.upsertMany([translation])
        })
      }

      return results
    },
    resolver: indexedResolver(),
    scheduler: windowScheduler(1000),
  })

  async generateTranslation({
    entryId,
    language,
    withContent,
    target,
    mode,
  }: {
    entryId: string
    language: SupportedActionLanguage
    withContent?: boolean
    target: TranslationTarget
    mode: TranslationMode
  }) {
    const entry = getEntry(entryId)

    if (!entry) return
    const translationSession = translationActions.getTranslation(entryId, language, mode)

    const fields = (
      ["title", "description", ...(withContent ? [target] : [])] as TranslationFieldArray
    ).filter((field) => {
      const content = entry[field]
      if (!content) return false

      if (translationSession?.[field]) return false

      return !checkLanguage({
        content,
        contentLanguage: entry.language,
        language,
      })
    })

    if (fields.length === 0) return null

    const key = `${entryId}|${language}|${target}|${fields.join(",")}|${mode}`
    const result = await this.translationBatcher.fetch(key)
    return result || null
  }
}

export const translationSyncService = new TranslationSyncService()
