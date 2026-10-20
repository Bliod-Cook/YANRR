import { describe, expect, test } from "vitest"

import { createAuthRequestOriginHeaders } from "./headers"

describe("createAuthRequestOriginHeaders", () => {
  test("uses the web origin for auth requests", () => {
    expect(createAuthRequestOriginHeaders("https://app.example.com/login?from=desktop")).toEqual({
      Origin: "https://app.example.com",
      Referer: "https://app.example.com",
    })
  })

  test("returns empty headers for invalid urls", () => {
    expect(createAuthRequestOriginHeaders("not-a-url")).toEqual({})
  })
})
