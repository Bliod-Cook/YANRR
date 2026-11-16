import { initializeDayjs } from "@follow/components/dayjs"
import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { useFeedStore } from "@follow/store/feed/store"
import type { FeedModel } from "@follow/store/feed/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { SocialMediaItem } from "./social-media-item"

const post = {
  id: "post-1",
  title: null,
  url: null,
  content: '<p><a href="tags/rss">#rss</a></p>',
  readabilityContent: null,
  description: null,
  guid: "post-1",
  author: "Alice",
  authorUrl: null,
  authorAvatar: null,
  insertedAt: new Date(),
  publishedAt: new Date(),
  media: null,
  categories: null,
  attachments: null,
  extra: null,
  language: null,
  feedId: "feed-1",
  inboxHandle: null,
  read: false,
  settings: null,
} as EntryModel

describe("SocialMediaItem", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    initializeDayjs()
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
  })

  test("resolves a relative link in a post without its own page against the feed's site", async () => {
    useFeedStore.setState({
      feeds: {
        "feed-1": {
          id: "feed-1",
          type: "feed",
          title: "Alice",
          siteUrl: "https://social.example.com/alice/",
        } as FeedModel,
      },
    })
    useEntryStore.setState({ data: { [post.id]: post } })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={jotaiStore}>
            <SocialMediaItem entryId={post.id} />
          </Provider>
        </QueryClientProvider>,
      )
    })

    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "https://social.example.com/alice/tags/rss",
    )
  })
})
