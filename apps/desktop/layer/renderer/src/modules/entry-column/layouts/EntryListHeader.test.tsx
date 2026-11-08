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
import { expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { EntryRootStateContext } from "../store/EntryColumnContext"
import { EntryListHeader } from "./EntryListHeader"

vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "https://rss.example.com/api")
  vi.stubEnv("VITE_WEB_URL", "https://rss.example.com")
})
vi.mock("~/lib/auth", () => ({}))
vi.mock("~/modules/ai-chat/hooks/useSendAIShortcut", () => ({
  useSendAIShortcut: () => ({ sendAIShortcut: () => {} }),
}))

const feedId = "1328554886337265664"

test("offers to refresh a followed feed, which has no owner on the Yanrr server", async () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  feedActions.upsertManyInSession([
    {
      id: feedId,
      url: "https://example.com/feed.xml",
      title: "Example",
      ownerUserId: null,
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

  const host = document.createElement("div")
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={jotaiStore}>
          <GlobalFocusableProvider>
            <EntryRootStateContext value={{ isScrolledBeyondThreshold: atom(false) }}>
              <EntryListHeader refetch={() => {}} isRefreshing={false} />
            </EntryRootStateContext>
          </GlobalFocusableProvider>
        </Provider>
      </QueryClientProvider>,
    )
  })

  expect(host.querySelector('[aria-label="entry_list_header.refresh"]')).not.toBeNull()
  await act(async () => root.unmount())
})
