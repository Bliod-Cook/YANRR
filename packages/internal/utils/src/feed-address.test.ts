import { describe, expect, it } from "vitest"

import { normalizeFeedAddress } from "./feed-address"

describe("normalizeFeedAddress", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["  example.com/feed.xml  ", "https://example.com/feed.xml"],
    ["https://example.com/feed.xml", "https://example.com/feed.xml"],
    ["http://example.com/feed", "http://example.com/feed"],
    ["rsshub://github/issue/follow/follow", "rsshub://github/issue/follow/follow"],
    ["example.com/blog/?format=rss&page=2", "https://example.com/blog/?format=rss&page=2"],
  ])("takes %j as %j", (input, address) => {
    expect(normalizeFeedAddress(input)).toBe(address)
  })

  it.each(["", "https://", "rsshub://", "not an address"])("refuses %j", (input) => {
    expect(normalizeFeedAddress(input)).toBeNull()
  })

  // As the server, which looks only for those
  it.each(["rust", "localhost/feed", "http://localhost:8080/rss", "ftp://example.com/feed"])(
    "refuses %j, which is no web address with a dotted host",
    (input) => {
      expect(normalizeFeedAddress(input)).toBeNull()
    },
  )

  it("takes an IP address", () => {
    expect(normalizeFeedAddress("127.0.0.1/feed")).toBe("https://127.0.0.1/feed")
  })
})
