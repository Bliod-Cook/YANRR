import { setRoute } from "@follow/components/atoms/route.js"
import { FeedViewType } from "@follow/constants"
import { entrySyncServices, useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { getReadabilityStatus, ReadabilityStatus, setReadabilityStatus } from "~/atoms/readability"
import { jotaiStore } from "~/lib/jotai"

import { toggleEntryReadability, useEntryActions } from "./useEntryActions"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))

const url = "https://example.com/post"

describe("toggleEntryReadability", () => {
  afterEach(() => {
    setReadabilityStatus({ "entry-1": ReadabilityStatus.INITIAL })
    vi.restoreAllMocks()
  })

  it("fetches the readable content of the entry page", async () => {
    const fetchContent = vi
      .spyOn(entrySyncServices, "fetchEntryReadabilityContent")
      .mockResolvedValue(undefined)

    await toggleEntryReadability({ id: "entry-1", url })

    expect(fetchContent).toHaveBeenCalledWith("entry-1", expect.any(Function))
    expect(getReadabilityStatus()["entry-1"]).toBe(ReadabilityStatus.SUCCESS)
  })

  it("stays off when it is turned off while the content loads", async () => {
    let finish = () => {}
    vi.spyOn(entrySyncServices, "fetchEntryReadabilityContent").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined)
        }),
    )

    const loading = toggleEntryReadability({ id: "entry-1", url })
    await toggleEntryReadability({ id: "entry-1", url })
    finish()
    await loading

    expect(getReadabilityStatus()["entry-1"]).toBe(ReadabilityStatus.INITIAL)
  })
})

const openEntry = (entryId: string) =>
  act(() => {
    setRoute({
      params: { timelineId: "articles", feedId: "feed-1", entryId },
      searchParams: new URLSearchParams(),
      location: { pathname: "", search: "", hash: "", state: null, key: "" },
    })
  })

describe("useEntryActions", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  const renders: unknown[] = []

  const ActionsProbe = ({ entryId }: { entryId: string }) => {
    renders.push(useEntryActions({ entryId, view: FeedViewType.Articles }))
    return null
  }

  const render = () =>
    act(() => {
      root?.render(
        <Provider store={jotaiStore}>
          <ActionsProbe entryId="entry-1" />
        </Provider>,
      )
    })

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    useEntryStore.setState({
      data: {
        "entry-1": {
          id: "entry-1",
          url,
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
    renders.length = 0
  })

  it("keeps a row's actions when other entries are opened", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await openEntry("entry-2")
    await render()
    const rendersBefore = renders.length

    await openEntry("entry-3")

    expect(renders).toHaveLength(rendersBefore)
  })

  it("builds the actions once for the same entry", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await render()
    await render()

    expect(renders.at(-1)).toBe(renders[0])
  })
})
