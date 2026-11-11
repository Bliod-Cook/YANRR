import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import type { useEntriesByView as useEntriesByViewType } from "../hooks/useEntriesByView"
import { EntriesProvider, useEntriesState } from "./EntriesContext"

const mocks = vi.hoisted(() => ({
  useEntriesByView: vi.fn(),
  routeParams: vi.fn(() => ({ view: 0 })),
}))

vi.mock("../hooks/useEntriesByView", () => ({
  useEntriesByView: mocks.useEntriesByView,
}))

vi.mock("~/hooks/biz/useRouteParams", () => ({
  useRouteParams: mocks.routeParams,
}))

const useEntriesByViewMock = mocks.useEntriesByView as unknown as {
  mockReturnValue: (value: ReturnType<typeof useEntriesByViewType>) => void
}

describe("EntriesProvider", () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }

    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
  })

  test("keeps its state while the entries hook returns the same data in a new object", async () => {
    const entriesIds = ["entry-1"]
    const value = () => ({
      type: "remote" as const,
      entriesIds,
      groupedCounts: undefined,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetching: false,
      isLoading: false,
      isOffline: false,
      error: null,
      isFetchNextPageError: false,
      insertedBefore: undefined,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
      hasNext: false,
      isRefetching: false,
      isReady: true,
    })
    useEntriesByViewMock.mockReturnValue(value())

    const seen: unknown[] = []
    const Consumer = () => {
      seen.push(useEntriesState())
      return null
    }
    const tree = () => (
      <EntriesProvider>
        <Consumer />
      </EntriesProvider>
    )

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(tree())
    })
    useEntriesByViewMock.mockReturnValue(value())
    await act(async () => {
      root?.render(tree())
    })

    expect(new Set(seen).size).toBe(1)
  })
})
