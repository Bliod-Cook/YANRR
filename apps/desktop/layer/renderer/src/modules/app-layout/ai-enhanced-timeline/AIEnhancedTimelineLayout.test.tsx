import { setRoute } from "@follow/components/atoms/route.js"
import { Provider } from "jotai"
import type { PropsWithChildren } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { AIEnhancedTimelineLayout } from "./AIEnhancedTimelineLayout"

vi.mock("~/lib/auth", () => ({}))
vi.mock("~/modules/ai-chat/components/layouts/AIChatRoot", () => ({
  AIChatRoot: ({ children }: PropsWithChildren) => children,
}))
vi.mock("~/modules/app-layout/ai/AIChatFixedPanel", () => ({ AIChatFixedPanel: () => null }))
vi.mock("~/modules/app-layout/ai/AISplineButton", () => ({ AIIndicator: () => null }))
vi.mock("~/modules/entry-column", () => ({ EntryColumn: () => null }))
vi.mock("~/modules/entry-content/components/entry-content", () => ({
  EntryContent: ({ entryId }: { entryId: string }) => <div data-entry-id={entryId} />,
}))
vi.mock("~/modules/entry-content/components/entry-header", () => ({
  AIEntryHeader: () => null,
}))
vi.mock("~/providers/main-view-hotkeys-provider", () => ({ MainViewHotkeysProvider: () => null }))

const renderLayout = (entryId: string) => {
  setRoute({
    params: { timelineId: "articles", entryId },
    searchParams: new URLSearchParams(),
    location: { pathname: "", search: "", hash: "", state: null, key: "" },
  })
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(
    <Provider store={jotaiStore}>
      <AIEnhancedTimelineLayout />
    </Provider>,
  )
  return container
}

afterEach(() => {
  setRoute({
    params: {},
    searchParams: new URLSearchParams(),
    location: { pathname: "", search: "", hash: "", state: null, key: "" },
  })
})

test("shows the muted Yanrr logo until an article is selected", () => {
  const placeholder = renderLayout("pending")
  const logo = placeholder.querySelector("svg")

  expect(logo?.querySelector("title")?.textContent).toBe("Yanrr")
  expect(logo?.classList.contains("grayscale")).toBe(true)

  const selected = renderLayout("article-1")
  expect(selected.querySelector("svg")).toBeNull()
  expect(selected.querySelector('[data-entry-id="article-1"]')).not.toBeNull()
})
