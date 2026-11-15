import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { VideoPlayer } from "./VideoPlayer"

const baseEntry = {
  title: "Video",
  content: null,
  readabilityContent: null,
  description: null,
  author: null,
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
}

describe("VideoPlayer", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
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

  const render = async (entry: EntryModel) => {
    useEntryStore.setState({ data: { [entry.id]: entry } })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <Provider store={jotaiStore}>
          <VideoPlayer entryId={entry.id} />
        </Provider>,
      )
    })
    return host
  }

  test("embeds a player that may autoplay and go full screen, without a duration overlay", async () => {
    const host = await render({
      ...baseEntry,
      id: "embed",
      guid: "embed",
      url: "https://www.bilibili.com/video/BV1GJ411x7h7",
      attachments: [{ url: "https://example.com/video", duration_in_seconds: 293 }],
    } as EntryModel)

    expect(host.querySelector("iframe")?.getAttribute("allow")).toBe("autoplay; fullscreen")
    expect(host.textContent).not.toContain("04:53")
  })
})
