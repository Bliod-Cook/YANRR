// @vitest-environment happy-dom
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { FeedViewType } from "@follow/constants"
import { FollowClient } from "@follow-app/client-sdk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, createElement } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { apiContext, queryClientContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useEntriesQuery } from "./hooks"

// The lists are what is tested, not how the entries are stored. The test database cannot stand in:
// with the DOM this needs, Vite rewrites the URL its migrations are read from.
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

type ServedEntry = { id: string; feedId: string; publishedAt: string; insertedAt: string }

const toItem = ({ id, feedId, publishedAt, insertedAt }: ServedEntry) => ({
  // Read, so that no unread counter is found to disagree and fetched
  read: true,
  feeds: { type: "feed", id: feedId, title: feedId, url: `https://example.com/${feedId}.xml` },
  entries: { id, guid: id, title: id, insertedAt, publishedAt },
})

/**
 * Answers `POST /entries` with the entries of the asked feed after the cursor, newest first, and
 * fails a request while `fail` is set. A request waits while `hold` is set, until it is released.
 */
const createEntriesServer = (entries: ServedEntry[]) => {
  const state = { entries, fail: false, hold: undefined as Promise<void> | undefined }
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    // The test window has another origin than the server
    response.setHeader("access-control-allow-origin", request.headers.origin ?? "*")
    response.setHeader("access-control-allow-headers", "*")
    if (request.method === "OPTIONS") {
      response.end()
      return
    }
    let body = ""
    for await (const chunk of request) body += chunk
    const { feedId, limit = 20, cursorId } = JSON.parse(body || "{}")
    await state.hold
    response.setHeader("content-type", "application/json")
    if (state.fail || request.url !== "/entries") {
      response.statusCode = 500
      response.end(JSON.stringify({ code: 1005, message: "Internal error" }))
      return
    }
    const ofFeed = state.entries.filter((entry) => entry.feedId === feedId)
    const start = cursorId ? ofFeed.findIndex((entry) => entry.id === cursorId) + 1 : 0
    response.end(JSON.stringify({ code: 0, data: ofFeed.slice(start, start + limit).map(toItem) }))
  }
  const server: Server = createServer((request, response) => void handle(request, response))
  return { server, state }
}

const at = (hour: number) => `2026-05-14T${String(hour).padStart(2, "0")}:00:00.000Z`
const served = (id: string, hour: number, insertedHour = hour, feedId = "feed-1") => ({
  id,
  feedId,
  publishedAt: at(hour),
  insertedAt: at(insertedHour),
})

describe("useEntriesQuery against a server", () => {
  let server: ReturnType<typeof createEntriesServer>
  let client: QueryClient
  let root: Root | undefined
  let result: ReturnType<typeof useEntriesQuery> | undefined

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  const listen = async (entries: ServedEntry[]) => {
    server = createEntriesServer(entries)
    await new Promise<void>((resolve) => server.server.listen(0, "127.0.0.1", resolve))
    const { port } = server.server.address() as AddressInfo
    apiContext.provide(
      new FollowClient({ baseURL: `http://127.0.0.1:${port}`, fetch }).api as unknown as FollowAPI,
    )
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClientContext.provide(client)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    client.clear()
    await new Promise((resolve) => server.server.close(resolve))
  })

  const Probe = ({ feedId }: { feedId: string }) => {
    result = useEntriesQuery({ feedId, view: FeedViewType.Articles, limit: 2 })
    return null
  }

  /** Waits for the assertion to pass, rendering what the query reports meanwhile */
  const until = (assertion: () => void) => act(() => vi.waitFor(assertion))

  const show = async (feedId = "feed-1") => {
    root ??= createRoot(document.createElement("div"))
    await act(async () =>
      root!.render(
        createElement(QueryClientProvider, { client }, createElement(Probe, { feedId })),
      ),
    )
    await until(() => expect(result?.isFetching).toBe(false))
  }

  const loadNextPage = async () => {
    await act(async () => {
      await result?.fetchNextPage()
    })
    await until(() => expect(result?.isFetching).toBe(false))
  }

  const fourEntries = [served("e0", 9), served("e1", 8), served("e2", 7), served("e3", 6)]

  it("keeps the loaded entries when the next page fails, and reports the failure", async () => {
    await listen(fourEntries)
    await show()

    server.state.fail = true
    await loadNextPage()

    expect(result?.entriesIds).toEqual(["e0", "e1"])
    expect(result?.error).toBeInstanceOf(Error)
    expect(result?.isFetchNextPageError).toBe(true)

    server.state.fail = false
    await loadNextPage()
    expect(result?.entriesIds).toEqual(["e0", "e1", "e2", "e3"])
    expect(result?.error).toBeNull()
  })

  it("keeps every loaded page until a refresh brings the first one", async () => {
    await listen(fourEntries)
    await show()
    await loadNextPage()

    server.state.fail = true
    let failure: Error | null | undefined
    await act(async () => {
      failure = await result?.refetch()
    })

    expect(failure).toBeInstanceOf(Error)
    await until(() => expect(result?.error).toBe(failure))
    expect(result?.entriesIds).toEqual(["e0", "e1", "e2", "e3"])

    server.state.fail = false
    server.state.entries = [served("new", 10), ...fourEntries]
    let release = () => {}
    server.state.hold = new Promise((resolve) => (release = resolve))
    let refresh: Promise<Error | null> | undefined
    await act(async () => {
      refresh = result?.refetch()
    })
    await until(() => expect(result?.isRefetching).toBe(true))
    expect(result?.entriesIds).toEqual(["e0", "e1", "e2", "e3"])

    release()
    await act(async () => {
      expect(await refresh).toBeNull()
    })
    await until(() => expect(result?.entriesIds).toEqual(["new", "e0"]))
    expect(result?.error).toBeNull()
  })

  it("bounds marking read by the newest insertion among the entries of the list on screen", async () => {
    await listen([
      served("e0", 9),
      // Published before e0, inserted after it
      served("e1", 8, 12),
      served("e2", 7),
      served("e3", 6, 13),
      served("other", 9, 20, "feed-2"),
    ])

    await show()
    // The server sends milliseconds and keeps more, so the newest is covered a millisecond later
    expect(result?.insertedBefore).toBe(Date.parse(at(12)) + 1)

    await loadNextPage()
    expect(result?.insertedBefore).toBe(Date.parse(at(13)) + 1)

    await show("feed-2")
    expect(result?.insertedBefore).toBe(Date.parse(at(20)) + 1)

    // Switched back to, the list is taken from the cache as it was
    await show("feed-1")
    expect(result?.insertedBefore).toBe(Date.parse(at(13)) + 1)
  })
})
