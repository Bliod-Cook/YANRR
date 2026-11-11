import { describe, expect, it } from "vitest"

import { checkLanguage } from "./language"

describe("checkLanguage", () => {
  it("does not treat English text as French", () => {
    expect(
      checkLanguage({
        content: "This is a short English summary about AI and mobile apps.",
        language: "fr-FR",
      }),
    ).toBe(false)
  })

  it("recognizes French text when French is the target language", () => {
    expect(
      checkLanguage({
        content: "Ceci est un resume en francais sur les applications mobiles et l'IA.",
        language: "fr-FR",
      }),
    ).toBe(true)
  })

  it("recognizes Traditional Chinese text when Traditional Chinese is the target language", () => {
    expect(
      checkLanguage({
        content: "這是一篇關於行動應用程式和人工智慧的繁體中文摘要，內容相當豐富。",
        language: "zh-TW",
      }),
    ).toBe(true)
  })

  it("trusts the language the server detected for the entry", () => {
    expect(
      checkLanguage({
        content: "<p>Too short</p>",
        contentLanguage: "zh",
        language: "zh-TW",
      }),
    ).toBe(true)
    expect(
      checkLanguage({
        content: "Ceci est un resume en francais sur les applications mobiles et l'IA.",
        contentLanguage: "en-US",
        language: "fr-FR",
      }),
    ).toBe(false)
  })
})
