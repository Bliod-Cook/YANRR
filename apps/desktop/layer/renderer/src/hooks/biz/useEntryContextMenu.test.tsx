import { FeedViewType } from "@follow/constants"
import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { contextMenuAtom, MenuItemText } from "~/atoms/context-menu"
import { jotaiStore } from "~/lib/jotai"

import { useEntryContextMenu } from "./useEntryContextMenu"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))
vi.mock("~/lib/inbox", () => ({ INBOX_EMAIL_DOMAIN: "@example.com" }))

const Row = () => {
  const { contextMenuProps, contextMenuHost } = useEntryContextMenu({
    entryId: "entry-1",
    view: FeedViewType.Articles,
    feedId: "feed-1",
  })
  return (
    <div data-testid="row" {...contextMenuProps}>
      {contextMenuHost}
    </div>
  )
}

describe("useEntryContextMenu", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    useEntryStore.setState({
      data: {
        "entry-1": {
          id: "entry-1",
          url: "https://example.com/post",
          publishedAt: new Date(),
          feedId: "feed-1",
          read: false,
        } as EntryModel,
      },
    })
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    root = null
    host = null
  })

  it("opens the menu with the entry's actions on a right click", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={jotaiStore}>
            <Row />
          </Provider>
        </QueryClientProvider>,
      )
    })
    expect(jotaiStore.get(contextMenuAtom).open).toBe(false)

    await act(async () => {
      host
        ?.querySelector("[data-testid=row]")
        ?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 7,
            clientY: 9,
          }),
        )
    })

    const state = jotaiStore.get(contextMenuAtom)
    expect(state.open).toBe(true)
    if (!state.open) return
    expect(state.position).toEqual({ x: 7, y: 9 })
    const labels = state.menuItems.filter((i) => i instanceof MenuItemText).map((i) => i.label)
    expect(labels).toContain("words.copy" + "space" + "words.entry words.id")
  })
})
