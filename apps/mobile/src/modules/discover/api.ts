import { followClient } from "@/src/lib/api-client"

import type { DiscoverCategories, Language } from "./constants"

const discoverLanguageMap = {
  all: "all",
  eng: "en",
  cmn: "zh-CN",
  fra: "fr-FR",
} as const

export const fetchRsshubPopular = (category: DiscoverCategories, lang: Language) => {
  const mappedLanguage = discoverLanguageMap[lang]

  return followClient.api.discover.rsshub({
    categories: category === "all" ? "popular" : category,
    ...(mappedLanguage !== "all" && { lang: mappedLanguage }),
  })
}
