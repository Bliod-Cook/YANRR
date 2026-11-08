import { describe, expect, it } from "vitest"

import { getSiteIconUrl, normalizeServerUrl } from "./server-url"

describe("normalizeServerUrl", () => {
  it.each([
    ["rss.example.com", "https://rss.example.com"],
    ["  http://localhost:3100/  ", "http://localhost:3100"],
    ["HTTPS://Example.com/yanrr//", "https://example.com/yanrr"],
    ["https://example.com/?tab=1#top", "https://example.com"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected)
  })

  it.each(["", "   ", "ftp://example.com", "not a server"])("rejects %j", (input) => {
    expect(normalizeServerUrl(input)).toBeNull()
  })
})

describe("getSiteIconUrl", () => {
  it("asks the server for the icon of the site's host", () => {
    expect(getSiteIconUrl("http://localhost:3000/api", "https://www.npr.org/podcasts/500005")).toBe(
      "http://localhost:3000/api/icons/www.npr.org",
    )
  })

  it("has none for what is no web address", () => {
    expect(getSiteIconUrl("http://localhost:3000/api", "www.npr.org")).toBeUndefined()
  })
})
