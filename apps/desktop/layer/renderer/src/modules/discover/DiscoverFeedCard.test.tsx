import { initializeDayjs } from "@follow/components/dayjs"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test, vi } from "vitest"

import { SearchResultContent } from "./DiscoverFeedCard"

vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "https://rss.example.com/api")
  vi.stubEnv("VITE_WEB_URL", "https://rss.example.com")
})

type Entry = Parameters<typeof SearchResultContent>[0]["entry"]

describe("SearchResultContent", () => {
  beforeAll(() => {
    initializeDayjs()
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  const render = async (entry: Partial<Entry>) => {
    const host = document.createElement("div")
    const root = createRoot(host)
    const full = { id: "1", publishedAt: "2026-10-01T00:00:00.000Z", title: "Post", ...entry }
    await act(async () => root.render(<SearchResultContent entry={full as Entry} />))
    return host
  }

  test("links to the entry it shows, though it is not stored", async () => {
    const host = await render({ url: "https://example.com/post" })

    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.com/post")
  })

  test("is no link without an address to open", async () => {
    const host = await render({ url: undefined })

    expect(host.querySelector("a")).toBeNull()
  })
})
