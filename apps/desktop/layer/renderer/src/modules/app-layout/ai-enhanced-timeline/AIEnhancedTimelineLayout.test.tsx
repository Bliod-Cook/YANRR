import { setRoute } from "@follow/components/atoms/route.js"
import { Provider } from "jotai"
import type { PropsWithChildren } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { AIEnhancedTimelineLayout } from "./AIEnhancedTimelineLayout"

const loadedAIModules = vi.hoisted(() => [] as string[])

vi.mock("~/lib/auth", () => ({}))
vi.mock("~/modules/ai-chat/components/layouts/AIChatRoot", () => {
  loadedAIModules.push("AIChatRoot")
  return { AIChatRoot: ({ children }: PropsWithChildren) => children }
})
vi.mock("~/modules/app-layout/ai/AIChatFixedPanel", () => {
  loadedAIModules.push("AIChatFixedPanel")
  return { AIChatFixedPanel: () => null }
})
vi.mock("~/modules/app-layout/ai/AISplineButton", () => {
  loadedAIModules.push("AIIndicator")
  return { AIIndicator: () => null }
})
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

test("keeps the article pane blank until an article is selected", () => {
  const placeholder = renderLayout("pending")
  const articlePane = placeholder.querySelector(".bg-theme-background")

  expect(articlePane?.innerHTML).toBe("")

  const selected = renderLayout("article-1")
  expect(selected.querySelector('[data-entry-id="article-1"]')).not.toBeNull()
})

test("loads no AI chat code while AI is off", () => {
  renderLayout("pending")

  expect(loadedAIModules).toEqual([])
})
