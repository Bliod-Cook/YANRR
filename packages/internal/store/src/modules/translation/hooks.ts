import type { SupportedActionLanguage } from "@follow/shared"
import type { SupportedLanguages } from "@follow-app/client-sdk"
import { useQueries } from "@tanstack/react-query"
import { useCallback } from "react"

import { useEntry, useEntryList } from "../entry/hooks"
import type { EntryModel } from "../entry/types"
import { useIsLoggedIn } from "../user/hooks"
import { translationSyncService, useTranslationStore } from "./store"
import type { TranslationMode } from "./types"

export const usePrefetchEntryTranslation = ({
  entryIds,
  withContent,
  target = "content",
  enabled,
  language,
  mode,
}: {
  entryIds: string[]
  withContent?: boolean
  target?: "content" | "readabilityContent"
  enabled: boolean
  language: SupportedActionLanguage
  mode: TranslationMode
}) => {
  const entryList = (useEntryList(entryIds)?.filter(
    (entry) => entry !== null && (enabled || !!entry?.settings?.translation),
  ) || []) as EntryModel[]

  const isLoggedIn = useIsLoggedIn()

  return useQueries({
    queries: isLoggedIn
      ? entryList.map((entry) => {
          const entryId = entry.id
          const targetContent =
            target === "readabilityContent" ? entry.readabilityContent : entry.content
          const finalWithContent = withContent && !!targetContent

          return {
            queryKey: ["translation", entryId, language, finalWithContent, target, mode],
            queryFn: () =>
              translationSyncService.generateTranslation({
                entryId,
                language,
                withContent: finalWithContent,
                target,
                mode,
              }),
          }
        })
      : [],
  })
}

export const useEntryTranslation = ({
  entryId,
  language,
  mode,
  enabled,
}: {
  entryId: string
  language: SupportedLanguages
  mode: TranslationMode
  enabled: boolean
}) => {
  const actionSetting = useEntry(entryId, (state) => state.settings?.translation)

  return useTranslationStore(
    useCallback(
      (state) => {
        if (!enabled && !actionSetting) return
        return state.data[entryId]?.[language as SupportedActionLanguage]?.[mode]
      },
      [actionSetting, entryId, language, mode, enabled],
    ),
  )
}
