import { describe, expect, test } from "vitest"

import { matchSupportedLanguage } from "./language"

describe("matchSupportedLanguage", () => {
  test.each([
    [["ja-JP"], "ja"],
    [["fr-CA"], "fr-FR"],
    [["en-GB"], "en"],
    [["zh-HK"], "zh-TW"],
    [["zh-SG"], "zh-CN"],
    [["zh"], "zh-CN"],
    [["zh-CN"], "zh-CN"],
  ])("finds the same language in the same script for %s", (preferred, expected) => {
    expect(matchSupportedLanguage(preferred)).toBe(expected)
  })

  test("takes the first preferred language it supports", () => {
    expect(matchSupportedLanguage(["de-DE", "not a language", "ja", "en"])).toBe("ja")
  })

  test("finds nothing for a language it does not support", () => {
    expect(matchSupportedLanguage(["de-DE"])).toBeUndefined()
  })
})
