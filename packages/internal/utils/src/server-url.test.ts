import { describe, expect, it } from "vitest"

import { normalizeServerUrl } from "./server-url"

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
