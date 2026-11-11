import { setRoute } from "@follow/components/atoms/route.js"
import { initializeDayjs } from "@follow/components/dayjs"
import { FeedViewType } from "@follow/constants"
import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { useSubscriptionStore } from "@follow/store/subscription/store"
import type { SubscriptionModel } from "@follow/store/subscription/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { EntryContentForPreview } from "./EntryContentForPreview"

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
  feedId: "podcast",
  inboxHandle: null,
  read: false,
  sources: null,
  settings: null,
} as EntryModel

const podcastSubscription: SubscriptionModel = {
  feedId: "podcast",
  inboxId: null,
  userId: "user-1",
  view: FeedViewType.Audios,
  hideFromTimeline: null,
  title: null,
  category: null,
  createdAt: null,
  type: "feed",
}

describe("EntryContentForPreview", () => {
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
    setRoute({
      params: {},
      searchParams: new URLSearchParams(),
      location: { pathname: "", search: "", hash: "", state: null, key: "" },
    })
  })

  // Entries open in the peek modal from the AI chat, whatever timeline is open
  test("renders the timestamps of an audio entry peeked from the articles timeline", async () => {
    useEntryStore.setState({ data: { [episode.id]: episode } })
    useSubscriptionStore.setState({ data: { podcast: podcastSubscription } })
    setRoute({
      params: { timelineId: "articles" },
      searchParams: new URLSearchParams(),
      location: { pathname: "/timeline/articles", search: "", hash: "", state: null, key: "" },
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={jotaiStore}>
            <EntryContentForPreview entryId={episode.id} />
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
