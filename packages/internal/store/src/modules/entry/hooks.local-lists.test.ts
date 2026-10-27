// @vitest-environment happy-dom
import { FeedViewType } from "@follow/constants"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { useEntryIdsByView } from "./hooks"
import { useEntryStore } from "./store"
import type { EntryModel } from "./types"

vi.mock("@follow/database/services/entry", () => ({ EntryService: {} }))

// Sorting reads publish dates, so counting the reads tells whether a list was sorted
const dateReads = { count: 0 }
const publishedAt = (time: number) =>
  ({
    getTime: () => {
      dateReads.count++
      return time
    },
  }) as unknown as Date

const entry = (id: string, time: number): EntryModel => ({
  id,
  guid: id,
  insertedAt: new Date(),
  publishedAt: publishedAt(time),
})

const Probe = ({ enabled }: { enabled: boolean }) =>
  createElement("output", null, useEntryIdsByView(FeedViewType.Articles, enabled)?.join(","))

describe("local entry lists", () => {
  let unmount = async () => {}

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await unmount()
  })

  const render = async (enabled: boolean) => {
    useEntryStore.setState({
      data: { older: entry("older", 1), newer: entry("newer", 2) },
      entryIdByView: {
        ...useEntryStore.getState().entryIdByView,
        [FeedViewType.Articles]: new Set(["older", "newer"]),
      },
    })
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () => root.render(createElement(Probe, { enabled })))
    unmount = () => act(async () => root.unmount())
    return host
  }

  const updateContent = () =>
    act(async () => {
      const { data } = useEntryStore.getState()
      useEntryStore.setState({ data: { ...data, older: { ...data.older!, content: "<p>…</p>" } } })
    })

  it("does not sort while the server's list is shown", async () => {
    await render(false)
    dateReads.count = 0

    await updateContent()

    expect(dateReads.count).toBe(0)
  })

  it("sorts the stored entries when they are what is shown", async () => {
    const host = await render(true)
    dateReads.count = 0

    await updateContent()

    expect(host.textContent).toBe("newer,older")
    expect(dateReads.count).toBeGreaterThan(0)
  })
})
