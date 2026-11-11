import { describe, expect, it } from "vitest"

import { resolveContentUrl } from "./content-url"

const base = "https://example.com/blog/post.html"

describe("resolveContentUrl", () => {
  it.each([
    ["images/a.png", "https://example.com/blog/images/a.png"],
    ["../a.png", "https://example.com/a.png"],
    ["/a.png", "https://example.com/a.png"],
    ["?p=2", "https://example.com/blog/post.html?p=2"],
    ["#note-1", "https://example.com/blog/post.html#note-1"],
    ["//cdn.example.net/a.png", "https://cdn.example.net/a.png"],
    ["httpfoo/a", "https://example.com/blog/httpfoo/a"],
    ["https://other.example.org/a", "https://other.example.org/a"],
  ])("resolves %s against the base", (url, expected) => {
    expect(resolveContentUrl(url, base)).toBe(expected)
  })

  it("drops a relative URL without a base, which would point at the app itself", () => {
    expect(resolveContentUrl("x/../../api/feeds/refresh", undefined)).toBeUndefined()
    expect(resolveContentUrl("https://other.example.org/a", null)).toBe(
      "https://other.example.org/a",
    )
  })

  it("only takes an http(s) base", () => {
    expect(resolveContentUrl("#a", "javascript:alert(1)")).toBeUndefined()
    expect(resolveContentUrl("a.png", "file:///etc/")).toBeUndefined()
    expect(resolveContentUrl("a.png", "not a url")).toBeUndefined()
  })
})
