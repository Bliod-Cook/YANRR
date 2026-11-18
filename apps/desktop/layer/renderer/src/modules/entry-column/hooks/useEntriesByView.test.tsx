import type { IncomingMessage, ServerResponse } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { setRoute } from "@follow/components/atoms/route.js"
import { apiContext, queryClientContext } from "@follow/store/context"
import { FollowClient } from "@follow-app/client-sdk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { setGeneralSetting } from "~/atoms/settings/general"
import { jotaiStore } from "~/lib/jotai"

import { useEntriesByView } from "./useEntriesByView"

vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "https://rss.example.com/api")
  vi.stubEnv("VITE_WEB_URL", "https://rss.example.com")
})
vi.mock("~/lib/auth", () => ({}))
// The timeline is what is tested, not how its entries are stored
vi.mock("@follow/database/services/entry", () => ({
  EntryService: { getEntryMany: async () => [], upsertMany: async () => {} },
}))
vi.mock("@follow/database/services/feed", () => ({
  FEED_EXTRA_DATA_KEYS: [],
  FeedService: { upsertMany: async () => {} },
}))
vi.mock("@follow/database/services/collection", () => ({
  CollectionService: { upsertMany: async () => {}, deleteMany: async () => {} },
}))

const feedId = "1328554886337265664"
const hour = (index: number) => new Date(Date.UTC(2026, 4, 14, index)).toISOString()

/** A full first page, newest first; entry 3 was inserted last */
const firstPage = Array.from({ length: 20 }, (_, index) => ({
  read: true,
  feeds: { type: "feed", id: feedId, title: "Feed", url: "https://example.com/feed.xml" },
  entries: {
    id: `entry-${index}`,
    guid: `entry-${index}`,
    title: `Entry ${index}`,
    publishedAt: hour(20 - index),
    insertedAt: hour(index === 3 ? 22 : 20 - index),
  },
}))

/** Answers the first page of entries and fails any other while `fail` is set */
const server = {
  fail: false,
  lastEntriesRequest: {} as { read?: boolean; isCollection?: boolean },
  handle: async (request: IncomingMessage, response: ServerResponse) => {
    // The test window has another origin than the server
    response.setHeader("access-control-allow-origin", request.headers.origin ?? "*")
    response.setHeader("access-control-allow-headers", "*")
    let body = ""
    for await (const chunk of request) body += chunk
    if (request.method === "OPTIONS" || request.url === "/entries/stream") {
      response.end()
      return
    }
    response.setHeader("content-type", "application/json")
    if (server.fail || request.url !== "/entries" || JSON.parse(body).cursorId) {
      response.statusCode = 500
      response.end(JSON.stringify({ code: 1005, message: "Internal error" }))
      return
    }
    server.lastEntriesRequest = JSON.parse(body)
    response.end(JSON.stringify({ code: 0, data: firstPage }))
  },
}
const http = createServer((request, response) => void server.handle(request, response))

describe("useEntriesByView", () => {
  let client: QueryClient
  let root: Root | undefined
  let result: ReturnType<typeof useEntriesByView> | undefined

  const Probe = () => {
    result = useEntriesByView()
    return null
  }

  /** Waits for the assertion to pass, rendering what the timeline reports meanwhile */
  const until = (assertion: () => void) => act(() => vi.waitFor(assertion))

  const show = async () => {
    root = createRoot(document.createElement("div"))
    await act(async () =>
      root!.render(
        <QueryClientProvider client={client}>
          <Provider store={jotaiStore}>
            <Probe />
          </Provider>
        </QueryClientProvider>,
      ),
    )
    await until(() => expect(result?.isLoading).toBe(false))
  }

  beforeAll(async () => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
    const { port } = http.address() as AddressInfo
    const { api } = new FollowClient({ baseURL: `http://127.0.0.1:${port}`, fetch })
    apiContext.provide(api as unknown as Parameters<typeof apiContext.provide>[0])
  })

  beforeEach(() => {
    setGeneralSetting("unreadOnly", false)
    setRoute({
      params: { timelineId: "articles", feedId },
      searchParams: new URLSearchParams(),
      location: { pathname: "", search: "", hash: "", state: null, key: "" },
    })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClientContext.provide(client)
    server.fail = false
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    client.clear()
  })

  afterAll(() => new Promise((resolve) => http.close(resolve)))

  it("fetches read and unread stars even when the timeline shows only unread entries", async () => {
    setGeneralSetting("unreadOnly", true)
    setRoute({
      params: { timelineId: "articles", feedId: "collections" },
      searchParams: new URLSearchParams(),
      location: { pathname: "", search: "", hash: "", state: null, key: "" },
    })
    await show()
    expect(server.lastEntriesRequest.isCollection).toBe(true)
    expect(server.lastEntriesRequest.read).toBeUndefined()
  })

  it("keeps the server's list when its next page fails", async () => {
    await show()
    expect(result?.type).toBe("remote")
    // Marking read covers the newest insertion on screen, by the server's clock
    expect(result?.insertedBefore).toBe(Date.parse(hour(22)) + 1)

    await act(async () => {
      await result?.fetchNextPage()
    })
    await until(() => expect(result?.error).toBeInstanceOf(Error))

    expect(result?.type).toBe("remote")
    expect(result?.entriesIds).toEqual(firstPage.map((item) => item.entries.id))
    expect(result?.isFetchNextPageError).toBe(true)
  })

  it("shows the stored entries, with no bound to mark them read by, while the first page fails", async () => {
    server.fail = true

    await show()

    expect(result?.type).toBe("local")
    expect(result?.error).toBeInstanceOf(Error)
    expect(result?.insertedBefore).toBeUndefined()
  })
})
