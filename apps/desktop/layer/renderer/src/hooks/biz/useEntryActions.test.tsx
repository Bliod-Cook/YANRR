import { setRoute } from "@follow/components/atoms/route.js"
import { FeedViewType } from "@follow/constants"
import { apiContext } from "@follow/store/context"
import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { getReadabilityStatus, ReadabilityStatus, setReadabilityStatus } from "~/atoms/readability"
import { setServerConfigs } from "~/atoms/server-configs"
import { jotaiStore } from "~/lib/jotai"
import { useRegisterEntryCommands } from "~/modules/command/commands/entry"
import { COMMAND_ID } from "~/modules/command/commands/id"

import { toggleEntryReadability, useEntryActions } from "./useEntryActions"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))
vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

const url = "https://example.com/post"

describe("toggleEntryReadability", () => {
  // The server's `/entries/readability`, which extracts the readable content of the entry page
  const readability = vi.fn()

  beforeEach(() => {
    readability.mockReset()
    apiContext.provide({ entries: { readability } } as unknown as Parameters<
      typeof apiContext.provide
    >[0])
    useEntryStore.setState({
      data: { "entry-1": { id: "entry-1", url, feedId: "feed-1" } as EntryModel },
    })
  })

  afterEach(() => {
    setReadabilityStatus({ "entry-1": ReadabilityStatus.INITIAL })
  })

  it("shows the readable content the server extracted from the entry page", async () => {
    readability.mockResolvedValue({ code: 0, data: { content: "<p>Readable</p>" } })

    await toggleEntryReadability({ id: "entry-1", url })

    expect(readability).toHaveBeenCalledWith({ id: "entry-1" })
    expect(getReadabilityStatus()["entry-1"]).toBe(ReadabilityStatus.SUCCESS)
    expect(useEntryStore.getState().data["entry-1"]?.readabilityContent).toBe("<p>Readable</p>")
  })

  it.each([
    ["the server finds nothing readable", () => ({ code: 0, data: { content: null } })],
    [
      "the server cannot be reached",
      () => {
        throw new TypeError("Failed to fetch")
      },
    ],
  ])("reports a failure when %s", async (_, answer) => {
    readability.mockImplementation(async () => answer())

    await toggleEntryReadability({ id: "entry-1", url })

    expect(getReadabilityStatus()["entry-1"]).toBe(ReadabilityStatus.FAILURE)
  })

  it("stays off when it is turned off while the content loads", async () => {
    let finish = () => {}
    readability.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ code: 0, data: { content: "<p>Readable</p>" } })
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
  const queryClient = new QueryClient()

  const ActionsProbe = ({ entryId }: { entryId: string }) => {
    useRegisterEntryCommands()
    renders.push(useEntryActions({ entryId, view: FeedViewType.Articles }))
    return null
  }

  const render = () =>
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Provider store={jotaiStore}>
            <ActionsProbe entryId="entry-1" />
          </Provider>
        </QueryClientProvider>,
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
    setServerConfigs(null)
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

  it("reuses the same actions after the commands are registered", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await render()
    const actions = renders.at(-1)
    expect(actions).toContainEqual(expect.objectContaining({ id: COMMAND_ID.entry.star }))

    await render()

    expect(renders.at(-1)).toBe(actions)
  })

  it("offers the translation toggle only on a server with AI", async () => {
    const offered = () =>
      (renders.at(-1) as { id: string }[]).some(
        ({ id }) => id === COMMAND_ID.entry.toggleAITranslation,
      )
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await render()
    expect(offered()).toBe(false)

    await act(async () => setServerConfigs({ ai: true, push: false, registration: false }))
    expect(offered()).toBe(true)
  })
})
