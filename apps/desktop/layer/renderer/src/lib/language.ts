import LanguageDetector from "i18next-browser-languagedetector"

import { currentSupportedLanguages } from "~/@types/constants"
import { I18N_LOCALE_KEY } from "~/constants"

// The language and its likely script, such as "zh-Hant" for zh-HK and zh-TW
const languageInScript = (tag: string) => {
  try {
    const { language, script } = new Intl.Locale(tag).maximize()
    return `${language}-${script}`
  } catch {
    // Not a language tag, such as a mistyped `?lng=`
    return null
  }
}

/** The first preferred language the app is translated to, in its region or another one */
export const matchSupportedLanguage = (preferred: readonly string[]) => {
  for (const tag of preferred) {
    const key = languageInScript(tag)
    const supported =
      key && currentSupportedLanguages.find((lang) => languageInScript(lang) === key)
    if (supported) return supported
  }
  return undefined
}

const languageDetector = new LanguageDetector(null, {
  order: ["querystring", "localStorage", "navigator"],
  lookupQuerystring: "lng",
  lookupLocalStorage: I18N_LOCALE_KEY,
  caches: ["localStorage"],
})

const defaultLanguage = matchSupportedLanguage([languageDetector.detect() ?? []].flat()) ?? "en"

export const getDefaultLanguage = () => {
  return defaultLanguage
}
