import { describe, expect, test } from "vitest"

import { encodeRSSHubRouteParams } from "./utils"

describe("encodeRSSHubRouteParams", () => {
  test("keeps values with query string characters whole for RSSHub", () => {
    const params = { item: "h2 + p", title: "Q&A = news", itemLink: "a/b?c" }

    const segment = encodeRSSHubRouteParams(params)

    // RSSHub decodes the path segment, then reads it as a query string
    expect(segment).not.toContain("/")
    expect(Object.fromEntries(new URLSearchParams(decodeURIComponent(segment)))).toEqual(params)
  })
})
