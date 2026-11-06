import { initializeDayjs } from "@follow/components/dayjs"
import { FeedViewType } from "@follow/constants"
import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { ArticleLayout } from "./ArticleLayout"

// happy-dom cannot host the shadow tree react-shadow creates
vi.mock("~/components/common/ShadowDOM", () => ({
  ShadowDOM: ({ children }: { children: React.ReactNode }) => children,
}))

const episode = {
  id: "episode-1",
  title: "Episode 1",
  url: "https://example.com/episode-1",
  content: "<p>01:30 Intro</p>",
  readabilityContent: null,
  description: null,
  guid: "episode-1",
  author: null,
  authorUrl: null,
  authorAvatar: null,
  insertedAt: new Date(),
  publishedAt: new Date(),
  media: null,
  categories: null,
  attachments: [{ url: "https://example.com/episode-1.mp3", mime_type: "audio/mpeg" }],
  extra: null,
  language: null,
  feedId: "feed-1",
  inboxHandle: null,
  read: false,
  sources: null,
  settings: null,
} as EntryModel

describe("ArticleLayout", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    initializeDayjs()
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    root = null
    host = null
  })

  test("renders the timestamps of an audio entry as seek points", async () => {
    useEntryStore.setState({ data: { [episode.id]: episode } })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={jotaiStore}>
            <ArticleLayout entryId={episode.id} view={FeedViewType.Audios} />
          </Provider>
        </QueryClientProvider>,
      )
    })

    const timestamp = [...host.querySelectorAll("article span")].find(
      (span) => span.textContent === "01:30",
    )
    expect(timestamp?.className).toContain("cursor-pointer")
  })
})
