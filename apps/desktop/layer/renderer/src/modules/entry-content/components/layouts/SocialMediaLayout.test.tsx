import { initializeDayjs } from "@follow/components/dayjs"
import { FeedViewType } from "@follow/constants"
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
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { SocialMediaLayout } from "./SocialMediaLayout"

const { previewMedia } = vi.hoisted(() => ({ previewMedia: vi.fn() }))

// The preview is a modal of the app shell, which a test does not mount
vi.mock("~/components/ui/media/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/components/ui/media/hooks")>()),
  usePreviewMedia: () => previewMedia,
}))

const post = {
  id: "post-1",
  title: null,
  url: "https://social.example.com/@alice/1",
  content: null,
  readabilityContent: null,
  description: null,
  guid: "post-1",
  author: "Alice",
  authorUrl: null,
  authorAvatar: null,
  insertedAt: new Date(),
  publishedAt: new Date(),
  media: [
    {
      url: "https://social.example.com/clip.mp4",
      type: "video",
      preview_image_url: "https://social.example.com/clip.jpg",
    },
    { url: "https://social.example.com/photo.jpg", type: "photo" },
  ],
  categories: null,
  attachments: null,
  extra: null,
  language: null,
  feedId: "feed-1",
  inboxHandle: null,
  read: false,
  settings: null,
} as EntryModel

describe("SocialMediaLayout", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    initializeDayjs()
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    useFeedStore.setState({
      feeds: {
        "feed-1": {
          id: "feed-1",
          type: "feed",
          title: "Alice",
          siteUrl: "https://social.example.com/",
        } as FeedModel,
      },
    })
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    root = null
    host = null
  })

  const render = async (entry: EntryModel) => {
    useEntryStore.setState({ data: { [entry.id]: entry } })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={jotaiStore}>
            <SocialMediaLayout entryId={entry.id} view={FeedViewType.SocialMedia} />
          </Provider>
        </QueryClientProvider>,
      )
    })
    return host
  }

  test("previews the clicked media among all of the post's media", async () => {
    const host = await render(post)

    host.querySelector<HTMLElement>('img[src="https://social.example.com/photo.jpg"]')?.click()

    expect(previewMedia).toHaveBeenCalledTimes(1)
    const [media, index] = previewMedia.mock.calls[0]!
    expect(media.map((m: { url: string }) => m.url)).toEqual([
      "https://social.example.com/clip.mp4",
      "https://social.example.com/photo.jpg",
    ])
    expect(index).toBe(1)
  })
})
