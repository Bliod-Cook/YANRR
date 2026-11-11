import dayjs from "dayjs"
import type { Locale } from "expo-localization"
import { getLocales } from "expo-localization"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import {
  currentSupportedLanguages,
  dayjsLocaleImportMap,
  defaultNS,
  ns,
} from "@/src/@types/constants"
import { defaultResources } from "@/src/@types/default-resource"

import { getGeneralSettings } from "../atoms/settings/general"
import { getE2ELanguage } from "./e2e-config"
import { applyZodLocale } from "./zod-locale"

const fallbackLanguage = "en"

const getForcedLanguage = () => {
  const language = getE2ELanguage()
  if (!language) {
    return null
  }

  return currentSupportedLanguages.includes(language) ? language : null
}

export const updateDayjsLocale = async (lang: string) => {
  if (!(lang in dayjsLocaleImportMap)) return
  const dayjsImport = dayjsLocaleImportMap[lang as keyof typeof dayjsLocaleImportMap]
  const [locale, loader] = dayjsImport
  await loader()
  dayjs.locale(locale)
}

/**
 * Switches the app language. Dates on screen re-render for the new language and format with the
 * dayjs locale, so that locale has to switch first.
 */
export const changeAppLanguage = async (language: string) => {
  await updateDayjsLocale(language)
  await i18n.changeLanguage(language)
}

export async function initializeI18n() {
  const { language: storedLanguage } = getGeneralSettings()
  const language = getForcedLanguage() ?? storedLanguage

  i18n.on("languageChanged", applyZodLocale)
  return Promise.all([
    updateDayjsLocale(language),
    i18n.use(initReactI18next).init({
      ns,
      defaultNS,
      resources: defaultResources,

      lng: language,
      fallbackLng: {
        default: [fallbackLanguage],
        "zh-TW": ["zh-CN", fallbackLanguage],
      },

      interpolation: {
        escapeValue: false,
      },
    }),
  ])
}

// Where Chinese is written in traditional characters
const traditionalChineseRegions = new Set(["TW", "HK", "MO"])

// Chinese goes by its script; Android may leave the script out, and then by the region
const getChineseRegion = ({ languageScriptCode, languageRegionCode }: Locale) => {
  const script =
    languageScriptCode ??
    (languageRegionCode && traditionalChineseRegions.has(languageRegionCode) ? "Hant" : "Hans")
  return script === "Hant" ? "TW" : "CN"
}

/** The app's language for the locale: the one of its region, else any of its language */
const matchLanguage = (locale: Locale) => {
  const { languageCode } = locale
  if (!languageCode) return
  const region = languageCode === "zh" ? getChineseRegion(locale) : locale.languageRegionCode
  return (
    currentSupportedLanguages.find((language) => language === `${languageCode}-${region}`) ??
    currentSupportedLanguages.find(
      (language) => language === languageCode || language.startsWith(`${languageCode}-`),
    )
  )
}

/** The first of the device's preferred languages the app has */
export function getDeviceLanguage() {
  for (const locale of getLocales()) {
    const language = matchLanguage(locale)
    if (language) return language
  }
  return fallbackLanguage
}
