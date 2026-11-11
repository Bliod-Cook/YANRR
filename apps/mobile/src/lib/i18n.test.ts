import dayjs from "dayjs"
import type { Locale } from "expo-localization"
import i18next from "i18next"
import { afterAll, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ locales: [] as Partial<Locale>[] }))

vi.mock("expo-localization", () => ({ getLocales: () => mocks.locales }))
vi.mock("@/src/@types/constants", () => ({
  currentSupportedLanguages: ["en", "ja", "zh-CN", "zh-TW", "fr-FR"],
  dayjsLocaleImportMap: {
    en: ["en", () => import("dayjs/locale/en")],
    ja: ["ja", () => import("dayjs/locale/ja")],
  },
  defaultNS: "default",
  ns: ["default"],
}))
vi.mock("@/src/@types/default-resource", () => ({ defaultResources: {} }))
vi.mock("../atoms/settings/general", () => ({
  getGeneralSettings: () => ({ language: "en" }),
}))
vi.mock("./e2e-config", () => ({ getE2ELanguage: () => null }))

const { changeAppLanguage, getDeviceLanguage } = await import("./i18n")

afterAll(() => {
  dayjs.locale("en")
})

describe("changeAppLanguage", () => {
  it("switches the dayjs locale before components re-render for the new language", async () => {
    await i18next.init({ lng: "en", resources: { en: {}, ja: {} } })
    const dayjsLocales: string[] = []
    const recordDayjsLocale = () => {
      dayjsLocales.push(dayjs.locale())
    }
    i18next.on("languageChanged", recordDayjsLocale)

    await changeAppLanguage("ja")

    i18next.off("languageChanged", recordDayjsLocale)
    expect(i18next.language).toBe("ja")
    expect(dayjsLocales).toEqual(["ja"])
  })
})

describe("getDeviceLanguage", () => {
  const locale = (
    languageCode: string,
    languageRegionCode: string | null,
    languageScriptCode: string | null = null,
  ): Partial<Locale> => ({ languageCode, languageRegionCode, languageScriptCode })

  it.each([
    ["Japanese in Japan", [locale("ja", "JP")], "ja"],
    ["English in Britain", [locale("en", "GB")], "en"],
    ["French in Canada", [locale("fr", "CA")], "fr-FR"],
    ["Simplified Chinese with the region set to the US", [locale("zh", "US", "Hans")], "zh-CN"],
    ["Traditional Chinese in Hong Kong", [locale("zh", "HK", "Hant")], "zh-TW"],
    ["Chinese in Hong Kong without a script, as on Android", [locale("zh", "HK")], "zh-TW"],
    ["the first preferred language the app has", [locale("de", "DE"), locale("ja", "JP")], "ja"],
    ["no language the app has", [locale("de", "DE")], "en"],
  ])("picks the language for %s", (_name, locales, language) => {
    mocks.locales = locales
    expect(getDeviceLanguage()).toBe(language)
  })
})
