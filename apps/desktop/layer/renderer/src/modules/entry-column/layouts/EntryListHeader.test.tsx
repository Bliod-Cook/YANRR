import { setRoute } from "@follow/components/atoms/route.js"
import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { FeedViewType } from "@follow/constants"
import { feedActions } from "@follow/store/feed/store"
import { subscriptionActions } from "@follow/store/subscription/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { atom, Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterAll, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { EntryRootStateContext } from "../store/EntryColumnContext"
import { EntryListHeader } from "./EntryListHeader"

/** The API, which answers a feed refresh once the test releases it */
const server = await vi.hoisted(async () => {
  const { createServer } = await import("node:http")
  const state = { refreshes: 0, release: () => {} }
  const answered = new Promise<void>((resolve) => (state.release = resolve))
  const http = createServer(async (request, response) => {
    // The test window has another origin than the server, and sends its credentials
    response.setHeader("access-control-allow-origin", request.headers.origin ?? "")
    response.setHeader("access-control-allow-credentials", "true")
    response.setHeader(
      "access-control-allow-headers",
      request.headers["access-control-request-headers"] ?? "",
    )
    if (request.method === "OPTIONS") {
      response.end()
      return
    }
    if (request.url?.startsWith("/feeds/refresh")) {
      state.refreshes++
      await answered
    }
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ code: 0, data: null }))
  })
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  const { port } = http.address() as { port: number }
  vi.stubEnv("VITE_API_URL", `http://127.0.0.1:${port}`)
  vi.stubEnv("VITE_WEB_URL", "https://rss.example.com")
  return { state, close: () => new Promise((resolve) => http.close(resolve)) }
})
vi.mock("~/lib/auth", () => ({}))

const feedId = "1328554886337265664"

afterAll(() => server.close())

test("refreshes a followed feed on the server, then loads its entries again", async () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  feedActions.upsertManyInSession([
    {
      id: feedId,
      url: "https://example.com/feed.xml",
      title: "Example",
    },
  ])
  void subscriptionActions.upsertManyInSession([
    { feedId, userId: "user-1", view: FeedViewType.Articles, type: "feed" },
  ])
  setRoute({
    params: { timelineId: "articles", feedId },
    searchParams: new URLSearchParams(),
    location: { pathname: "", search: "", hash: "", state: null, key: "" },
  })
  const refetch = vi.fn()

  const host = document.createElement("div")
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={jotaiStore}>
          <GlobalFocusableProvider>
            <EntryRootStateContext value={{ isScrolledBeyondThreshold: atom(false) }}>
              <EntryListHeader refetch={refetch} isRefreshing={false} />
            </EntryRootStateContext>
          </GlobalFocusableProvider>
        </Provider>
      </QueryClientProvider>,
    )
  })

  const refresh = host.querySelector<HTMLButtonElement>('[aria-label="entry_list_header.refresh"]')
  await act(async () => refresh?.click())
  await vi.waitFor(() => expect(server.state.refreshes).toBe(1))
  // The server is still fetching the feed, so the list would come back without its new entries
  expect(refetch).not.toHaveBeenCalled()

  server.state.release()
  await act(() => vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1)))
  await act(async () => root.unmount())
})
