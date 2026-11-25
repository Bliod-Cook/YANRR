import { describe, expect, test } from "vitest"

import { createAuthRequestOriginHeaders, createBuildSafeHeaders } from "./headers"

describe("createBuildSafeHeaders", () => {
  test("asks hotlink-protected hosts for images from their site, as a browser", () => {
    const headers = createBuildSafeHeaders(
      "https://rss.example.com",
      [],
    )({
      url: "https://i.pximg.net/img-original/a.png",
    })
    expect(headers).toMatchObject({
      Referer: "https://www.pixiv.net",
      Origin: "https://www.pixiv.net",
      "User-Agent": expect.stringContaining("Chrome/"),
    })
  })
})

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
