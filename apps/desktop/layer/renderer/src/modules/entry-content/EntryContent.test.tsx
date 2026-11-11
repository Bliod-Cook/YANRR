import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { setRoute } from "@follow/components/atoms/route.js"
import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { initializeDayjs } from "@follow/components/dayjs"
import { entrySyncServices, useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { enableShowSourceContent, resetShowSourceContent } from "~/atoms/source-content"
import { jotaiStore } from "~/lib/jotai"

import { EntryContent } from "./EntryContent"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))
// happy-dom cannot host the shadow tree react-shadow creates
vi.mock("~/components/common/ShadowDOM", () => ({
  ShadowDOM: Object.assign(({ children }: { children: React.ReactNode }) => children, {
    useIsShadowDOM: () => false,
  }),
}))

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nSpoken words\n"

const createEntry = (id: string, fields: Partial<EntryModel>) =>
  ({
    id,
    title: `Title of ${id}`,
    url: `https://example.com/${id}`,
    content: null,
    readabilityContent: null,
    description: null,
    guid: id,
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
    ...fields,
  }) as EntryModel

describe("EntryContent", () => {
  let server: Server
  let serverUrl = ""
  const requestedPaths: string[] = []
  let root: Root | null = null
  let host: HTMLElement | null = null
  let queryClient: QueryClient

  const render = async (entries: EntryModel[], timelineId: string) => {
    useEntryStore.setState({ data: Object.fromEntries(entries.map((entry) => [entry.id, entry])) })
    for (const entry of entries) queryClient.setQueryData(["entry", entry.id], entry)
    setRoute({
      params: { timelineId },
      searchParams: new URLSearchParams(),
      location: { pathname: "", search: "", hash: "", state: null, key: "" },
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await show(entries[0]!.id)
    return host
  }

  const show = (entryId: string) =>
    act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Provider store={jotaiStore}>
            <GlobalFocusableProvider>
              <EntryContent entryId={entryId} />
            </GlobalFocusableProvider>
          </Provider>
        </QueryClientProvider>,
      )
    })

  beforeAll(async () => {
    initializeDayjs()
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    server = createServer((request, response) => {
      response.setHeader("access-control-allow-origin", "*")
      // happy-dom asks before it fetches across origins
      if (request.method === "OPTIONS") {
        response.setHeader("access-control-allow-headers", "*")
        response.end()
        return
      }
      requestedPaths.push(request.url ?? "")
      if (request.url === "/episode.srt") {
        response.end(SRT)
        return
      }
      response.statusCode = 404
      response.end("Not found")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    // The entries are in the cache already, as after the timeline loaded them
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    vi.spyOn(entrySyncServices, "fetchEntryReadabilityContent").mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    root = null
    host = null
    resetShowSourceContent()
    vi.restoreAllMocks()
  })

  test("shows the title of an entry with neither content nor link, and says it has no content", async () => {
    const container = await render([createEntry("notice", { url: null })], "notifications")

    expect(container.textContent).toContain("Title of notice")
    expect(container.textContent).toContain("entry_content.no_content")
  })

  test("fetches the readable page of an article without content", async () => {
    await render([createEntry("article", {})], "articles")

    expect(entrySyncServices.fetchEntryReadabilityContent).toHaveBeenCalledWith("article")
  })

  // The picture layout shows the pictures and the feed content, never the readable page
  test("leaves the page of a picture entry without content alone", async () => {
    const picture = createEntry("picture", {
      media: [{ url: "https://example.com/picture.jpg", type: "photo" }],
    })
    await render([picture], "pictures")

    expect(entrySyncServices.fetchEntryReadabilityContent).not.toHaveBeenCalled()
  })

  test("keeps the source page closed for an entry without a link", async () => {
    enableShowSourceContent()
    const container = await render(
      [createEntry("linkless", { url: null, content: "<p>Body</p>" })],
      "articles",
    )

    expect(container.querySelector("iframe")).toBeNull()
  })

  test("shows the content of the next entry after the subtitles of one were open", async () => {
    const episode = createEntry("episode", {
      content: "<p>Show notes</p>",
      attachments: [{ url: `${serverUrl}/episode.srt`, mime_type: "text/srt" }],
    })
    const post = createEntry("post", { content: "<p>Post body</p>" })
    const container = await render([episode, post], "articles")
    const transcriptTab = await vi.waitFor(() => {
      const tab = [...container.querySelectorAll('[role="tab"]')].find((element) =>
        element.textContent?.includes("entry_content.transcript.tab_transcript"),
      )
      if (!tab) throw new Error("No transcript tab yet")
      return tab as HTMLElement
    })
    await act(async () => {
      transcriptTab.click()
    })
    expect(container.textContent).toContain("Spoken words")

    await show(post.id)

    expect(container.textContent).toContain("Post body")
  })

  test("offers no subtitles that failed to load", async () => {
    const episode = createEntry("episode", {
      content: "<p>Show notes</p>",
      attachments: [{ url: `${serverUrl}/missing.srt`, mime_type: "text/srt" }],
    })
    const container = await render([episode], "articles")
    await vi.waitFor(() => {
      if (!requestedPaths.includes("/missing.srt") || queryClient.isFetching() > 0) {
        throw new Error("Still loading the subtitles")
      }
    })
    await act(async () => {})

    expect(container.querySelector('[role="tab"]')).toBeNull()
  })
})
