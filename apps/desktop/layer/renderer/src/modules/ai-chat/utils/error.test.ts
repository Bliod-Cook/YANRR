import enErrors from "@locales/errors/en.json"
import i18next from "i18next"
import { beforeAll, describe, expect, it } from "vitest"

import { getChatErrorMessage } from "./error"

describe("getChatErrorMessage", () => {
  beforeAll(async () => {
    await i18next.init({ lng: "en", resources: { en: { errors: enErrors } } })
  })

  it("translates the code of the server's error", () => {
    expect(
      getChatErrorMessage(new Error(JSON.stringify({ code: 5, message: "AI is not configured" }))),
    ).toBe(enErrors["5"])
  })

  it("shows the server's message for a code without a translation", () => {
    expect(
      getChatErrorMessage(new Error(JSON.stringify({ code: 99_999, message: "Something new" }))),
    ).toBe("Something new")
  })

  it("keeps other messages as they are", () => {
    expect(getChatErrorMessage(new Error("Something else went wrong"))).toBe(
      "Something else went wrong",
    )
    expect(getChatErrorMessage("constructor")).toBe("constructor")
    expect(getChatErrorMessage("42")).toBe("42")
  })
})
