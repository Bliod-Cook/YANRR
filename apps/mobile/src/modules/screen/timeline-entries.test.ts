import type { UseEntriesReturn } from "@follow/store/entry/types"
import { fallbackReturn } from "@follow/store/entry/utils"
import type { InfiniteData } from "@tanstack/react-query"
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import {
  getRemoteTimelineEntries,
  joinRefreshAttempt,
  pickTimelineEntries,
} from "./timeline-entries"

type Page = { data: { entries: { id: string } }[] }

const queryKey = ["entries", "feed-1"]
const actions = {
  refetch: async () => {},
  refetchReportingFailure: async () => {},
  fetchNextPage: async () => {},
}

/**
 * The server's list as TanStack holds it: an observer of a list whose requests are answered in
 * order by `answers`, the ids of a page or the error it fails with.
 */
const observeList = (answers: (string[] | Error)[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const pending = [...answers]
  return new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, string[], number>(client, {
    queryKey,
    queryFn: async () => {
      const answer = pending.shift()!
      if (answer instanceof Error) throw answer
      return { data: answer.map((id) => ({ entries: { id } })) }
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, pages) => pages.length,
  })
}

/** The state of a list once its first page was asked for (again) */
const load = async (list: ReturnType<typeof observeList>) => {
  await list.refetch()
  return list.getCurrentResult()
}

/** The state of a list on screen, which starts loading its first page */
const showList = (answers: (string[] | Error)[]) => {
  const list = observeList(answers)
  list.subscribe(() => {})
  return list.getCurrentResult()
}

/** What the timeline reads from an observer's state, with the ids the store derives from it */
const toRemote = (result: ReturnType<ReturnType<typeof observeList>["getCurrentResult"]>) =>
  getRemoteTimelineEntries(
    {
      ...result,
      entriesIds:
        result.data?.pages.flatMap((page) => page.data.map(({ entries }) => entries.id)) ?? [],
      insertedBefore: result.data ? 1 : undefined,
    },
    actions,
  )

const local = (entriesIds: string[]): UseEntriesReturn => ({
  ...fallbackReturn,
  entriesIds,
  isLoading: false,
  isReady: true,
})

describe("pickTimelineEntries", () => {
  it("shows the server's entries once its first page is in", async () => {
    const result = await load(observeList([["new", "stored"]]))
    const shown = pickTimelineEntries(toRemote(result), local(["stored"]))

    expect(shown.entriesIds).toEqual(["new", "stored"])
    // A refresh that fails leaves them on screen, so it says so
    expect(shown.refetch).toBe(actions.refetchReportingFailure)
  })

  it("keeps the server's entries when the next page fails, and stops paging until asked", async () => {
    const error = new Error("fetch failed: offline")
    const list = observeList([["a", "b"], error])
    await load(list)
    const result = await list.fetchNextPage()
    const shown = pickTimelineEntries(toRemote(result), local(["stored"]))

    expect(shown.entriesIds).toEqual(["a", "b"])
    expect(shown.error).toBe(error)
    expect(shown.isFetchNextPageError).toBe(true)
    expect(shown.hasNextPage).toBe(false)
    expect(shown.insertedBefore).toBe(1)
  })

  it("keeps the server's entries when a refresh fails", async () => {
    const error = new Error("fetch failed: offline")
    const list = observeList([["a", "b"], error])
    await load(list)
    const result = await load(list)
    const shown = pickTimelineEntries(toRemote(result), local(["stored"]))

    expect(shown.entriesIds).toEqual(["a", "b"])
    expect(shown.error).toBe(error)
    expect(shown.isFetchNextPageError).toBe(false)
  })

  it("shows the stored entries while the first page loads", () => {
    const shown = pickTimelineEntries(toRemote(showList([["new"]])), local(["stored"]))

    expect(shown.entriesIds).toEqual(["stored"])
    expect(shown.isReady).toBe(true)
    expect(shown.isFetching).toBe(true)
    expect(shown.error).toBeNull()
    expect(shown.insertedBefore).toBeUndefined()
  })

  it("shows the stored entries and the error when the first page failed", async () => {
    const error = new Error("fetch failed: offline")
    const result = await load(observeList([error]))
    const shown = pickTimelineEntries(toRemote(result), local(["stored"]))

    expect(shown.entriesIds).toEqual(["stored"])
    expect(shown.error).toBe(error)
    expect(shown.refetch).toBe(actions.refetchReportingFailure)
  })

  it("reports a failed first page without stored entries, so the empty list says why", async () => {
    const error = new Error("fetch failed: offline")
    const result = await load(observeList([error]))
    const shown = pickTimelineEntries(toRemote(result), local([]))

    expect(shown.entriesIds).toEqual([])
    expect(shown.isReady).toBe(true)
    expect(shown.error).toBe(error)
    // The empty list shows the error, so a refresh does not toast it as well
    expect(shown.refetch).toBe(actions.refetch)
  })

  it("shows placeholders while loading without stored entries", () => {
    const shown = pickTimelineEntries(toRemote(showList([["new"]])), local([]))

    expect(shown.isReady).toBe(false)
    expect(shown.isFetching).toBe(true)
    expect(shown.refetch).toBe(actions.refetch)
  })
})

describe("joinRefreshAttempt", () => {
  it("joins the refresh under way, so one failed request is told once", async () => {
    const attempt: { current: Promise<void> | null } = { current: null }
    let settle!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)))

    // Pulling again while the first page still loads, as the list shows no spinner meanwhile
    const first = joinRefreshAttempt(attempt, refresh)
    const second = joinRefreshAttempt(attempt, refresh)
    expect(second).toBe(first)
    expect(refresh).toHaveBeenCalledTimes(1)

    settle()
    await first
    // A pull after it settled refreshes again
    void joinRefreshAttempt(attempt, refresh)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
