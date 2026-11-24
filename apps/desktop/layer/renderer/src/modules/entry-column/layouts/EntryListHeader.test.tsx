import { setRoute } from "@follow/components/atoms/route.js"
import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { FeedViewType } from "@follow/constants"
import { feedActions } from "@follow/store/feed/store"
import { subscriptionActions } from "@follow/store/subscription/store"
import { getOS } from "@follow/utils/utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { atom, Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterAll, beforeAll, expect, test, vi } from "vitest"

import { getGeneralSettings, setGeneralSetting } from "~/atoms/settings/general"
import { Focusable } from "~/components/common/Focusable"
import { HotkeyScope } from "~/constants"
import { jotaiStore } from "~/lib/jotai"
import { useRegisterTimelineCommand } from "~/modules/command/commands/timeline"

import { EntryColumnShortcutHandler } from "../EntryColumnShortcutHandler"
import { EntryRootStateContext } from "../store/EntryColumnContext"
import { EntryListHeader } from "./EntryListHeader"

/** The API, which answers a feed refresh once the test releases it */
const server = await vi.hoisted(async () => {
  const { createServer } = await import("node:http")
  const state = { refreshes: 0, answered: Promise.resolve() }
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
      await state.answered
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

beforeAll(() => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => server.close())

const TimelineCommands = () => {
  useRegisterTimelineCommand()
  return null
}

/** The header with the timeline's own shortcuts, which bind R to a refetch */
const renderHeader = async (refetch: () => void) => {
  const host = document.createElement("div")
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={jotaiStore}>
          <GlobalFocusableProvider>
            <TimelineCommands />
            <EntryRootStateContext value={{ isScrolledBeyondThreshold: atom(false) }}>
              <EntryListHeader refetch={refetch} isRefreshing={false} />
              <Focusable scope={HotkeyScope.Timeline}>
                <EntryColumnShortcutHandler refetch={refetch} data={[]} handleScrollTo={vi.fn()} />
              </Focusable>
            </EntryRootStateContext>
          </GlobalFocusableProvider>
        </Provider>
      </QueryClientProvider>,
    )
  })
  return { host, root }
}

const refreshShortcut = () => {
  const isMac = getOS() === "macOS"
  return new KeyboardEvent("keydown", {
    key: "r",
    code: "KeyR",
    ctrlKey: !isMac,
    metaKey: isMac,
    bubbles: true,
    cancelable: true,
  })
}

test.each(["click", "shortcut"])("refreshes a feed via %s before refetching", async (trigger) => {
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
  const answer = Promise.withResolvers<void>()
  server.state.refreshes = 0
  server.state.answered = answer.promise

  const { host, root } = await renderHeader(refetch)
  const shortcut = refreshShortcut()
  try {
    await act(async () => {
      if (trigger === "click") {
        host.querySelector<HTMLButtonElement>('[aria-label="entry_list_header.refresh"]')!.click()
      } else {
        document.body.dispatchEvent(shortcut)
      }
    })
    await vi.waitFor(() => expect(server.state.refreshes).toBe(1))
    if (trigger === "shortcut") expect(shortcut.defaultPrevented).toBe(true)
    expect(refetch).not.toHaveBeenCalled()

    answer.resolve()
    await act(() => vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1)))
  } finally {
    answer.resolve()
    await act(async () => root.unmount())
  }
})

test("refetches a timeline other than a feed on the refresh shortcut, as its button does", async () => {
  setRoute({
    params: { timelineId: "articles", feedId: "folder-Tech" },
    searchParams: new URLSearchParams(),
    location: { pathname: "", search: "", hash: "", state: null, key: "" },
  })
  server.state.refreshes = 0
  const refetch = vi.fn()

  const { root } = await renderHeader(refetch)
  const shortcut = refreshShortcut()
  try {
    await act(async () => {
      document.body.dispatchEvent(shortcut)
    })
    expect(shortcut.defaultPrevented).toBe(true)
    expect(refetch).toHaveBeenCalledOnce()
    expect(server.state.refreshes).toBe(0)
  } finally {
    await act(async () => root.unmount())
  }
})

test("toggles unread only once on its shortcut, which the command system binds", async () => {
  setRoute({
    params: { timelineId: "articles" },
    searchParams: new URLSearchParams(),
    location: { pathname: "", search: "", hash: "", state: null, key: "" },
  })
  setGeneralSetting("unreadOnly", false)
  const onBeforeRefresh = vi.fn()

  const root = createRoot(document.createElement("div"))
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={jotaiStore}>
          <GlobalFocusableProvider>
            <TimelineCommands />
            <EntryRootStateContext value={{ isScrolledBeyondThreshold: atom(false) }}>
              <EntryListHeader
                refetch={vi.fn()}
                isRefreshing={false}
                onBeforeRefresh={onBeforeRefresh}
              />
            </EntryRootStateContext>
          </GlobalFocusableProvider>
        </Provider>
      </QueryClientProvider>,
    )
  })

  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "u", code: "KeyU", bubbles: true, cancelable: true }),
    )
  })

  expect(getGeneralSettings().unreadOnly).toBe(true)
  // The list scrolls back to the top before it changes, as for a click
  expect(onBeforeRefresh).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
})
