import type { SupportedActionLanguage } from "@follow/shared/language"
import { ACTION_LANGUAGE_MAP } from "@follow/shared/language"
import { franc } from "franc-min"

import { parseHtml } from "./html"
import { duplicateIfLengthLessThan } from "./utils"

const detectableLanguageCodes = Object.values(ACTION_LANGUAGE_MAP).flatMap(({ code }) =>
  code ? [code] : [],
)

const primaryLanguage = (tag: string) => tag.split("-")[0]!.toLowerCase()

/**
 * Whether `content` is already written in `language`.
 * `contentLanguage` is the language the server detected for the entry (ISO 639-1, `zh` for any
 * Chinese); when it is known, the text is not inspected.
 */
export const checkLanguage = ({
  content,
  contentLanguage,
  language,
}: {
  content: string
  contentLanguage?: string | null
  language: SupportedActionLanguage
}) => {
  if (!content) return true
  if (contentLanguage) return primaryLanguage(contentLanguage) === primaryLanguage(language)
  const pureContent = parseHtml(content)
    .toText()
    .replaceAll(/https?:\/\/\S+|www\.\S+/g, " ")
  const { code } = ACTION_LANGUAGE_MAP[language]
  if (!code) {
    return false
  }

  const sourceLanguage = franc(duplicateIfLengthLessThan(pureContent, 20), {
    only: detectableLanguageCodes,
  })

  return sourceLanguage === code
}
