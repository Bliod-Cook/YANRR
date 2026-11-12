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

import { setServerConfigs } from "~/atoms/server-configs"
import { initializeDefaultGeneralSettings, setGeneralSetting } from "~/atoms/settings/general"
import { jotaiStore } from "~/lib/jotai"

import { ArticleLayout } from "./ArticleLayout"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))
// happy-dom cannot host the shadow tree react-shadow creates
vi.mock("~/components/common/ShadowDOM", () => ({
  ShadowDOM: Object.assign(({ children }: { children: React.ReactNode }) => children, {
    useIsShadowDOM: () => false,
  }),
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
    setServerConfigs(null)
    initializeDefaultGeneralSettings()
  })

  test("shows the AI summary when the server supports summaries without AI chat", async () => {
    setServerConfigs({ ai: true, push: false, registration: false })
    setGeneralSetting("summary", true)
    setGeneralSetting("actionLanguage", "en")
    useEntryStore.setState({ data: { [episode.id]: episode } })
    const client = new QueryClient()
    client.setQueryData(["summary", episode.id, "content", "en"], "An overview of the episode.")
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <QueryClientProvider client={client}>
          <Provider store={jotaiStore}>
            <ArticleLayout entryId={episode.id} view={FeedViewType.Articles} />
          </Provider>
        </QueryClientProvider>,
      )
    })

    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(host?.textContent).toContain("An overview of the episode.")
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
