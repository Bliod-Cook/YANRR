import { setNavigate, setRoute } from "@follow/components/atoms/route.js"
import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { FeedViewType } from "@follow/constants"
import { entryActions } from "@follow/store/entry/store"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { expect, test, vi } from "vitest"

import { EntryItemWrapper } from "./EntryItemWrapper"

vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "https://example.org/api")
  vi.stubEnv("VITE_WEB_URL", "https://example.org")
})
vi.mock("~/lib/auth", () => ({}))

test("lets the browser open a modified link while an ordinary click opens the article in place", async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const entryId = "article-1"
  const feedId = "all"
  const path = "/timeline/articles/all/pending"
  setRoute({
    params: { timelineId: "articles", feedId, entryId: "pending" },
    searchParams: new URLSearchParams(),
    location: { pathname: path, search: "", hash: "", state: null, key: "" },
  })
  entryActions.upsertManyInSession([
    {
      id: entryId,
      guid: entryId,
      feedId: "source",
      read: true,
      publishedAt: new Date(),
      insertedAt: new Date(),
    },
  ])
  const navigate = vi.fn()
  setNavigate({ fn: navigate })
  const host = document.createElement("div")
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <GlobalFocusableProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route
                path="/timeline/:timelineId/:feedId"
                element={<EntryItemWrapper entryId={entryId} view={FeedViewType.Articles} />}
              >
                <Route path=":entryId" element={null} />
              </Route>
            </Routes>
          </MemoryRouter>
        </GlobalFocusableProvider>,
      ),
    )
    const link = host.querySelector("a")!
    expect(link.getAttribute("href")).toBe("/timeline/articles/all/article-1")
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const click = new MouseEvent("click", { ...modifier, bubbles: true, cancelable: true })
      await act(async () => {
        link.dispatchEvent(click)
      })
      expect(click.defaultPrevented).toBe(false)
    }
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => link.click())
    expect(navigate).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
  }
})
