import type { FeedViewType } from "@follow/constants"
import { createContext, use, useCallback, useLayoutEffect, useMemo, useRef } from "react"

import { useRouteParams } from "~/hooks/biz/useRouteParams"

import { useEntriesByView } from "../hooks/useEntriesByView"

type EntriesStateContextValue = {
  type: "remote" | "local"
  entriesIds: string[]
  groupedCounts?: number[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetching: boolean
  isLoading: boolean
  /** Nothing is cached and the first page waits for the browser to come back online. */
  isOffline: boolean
  error: unknown | null
  /** The request `error` tells of asked for the next page, not for the first one */
  isFetchNextPageError: boolean
  view: FeedViewType
  /** Marking the list read up to its end covers what was inserted before this */
  insertedBefore?: number
}

type EntriesActionsContextValue = {
  fetchNextPage: () => void | Promise<void>
  refetch: () => void | Promise<void>
}

const EntriesStateContext = createContext<EntriesStateContextValue | undefined>(undefined)
const EntriesActionsContext = createContext<EntriesActionsContextValue | undefined>(undefined)

export const EntriesProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { view } = useRouteParams()

  const entries = useEntriesByView()

  const { type: syncType } = entries

  // Keep latest dynamic values in refs for stable actions
  const fetchNextPageRef = useRef(entries.fetchNextPage)
  useLayoutEffect(() => {
    fetchNextPageRef.current = entries.fetchNextPage
  }, [entries.fetchNextPage])

  const refetchRef = useRef(entries.refetch)
  useLayoutEffect(() => {
    refetchRef.current = entries.refetch
  }, [entries.refetch])

  // Stable actions that reference latest refs
  const fetchNextPageStable = useCallback(() => fetchNextPageRef.current?.(), [])
  const refetchStable = useCallback(() => refetchRef.current?.(), [])

  // Listed by field: `entries` is a new object on every render, which would rebuild the value
  // and re-render every consumer each time
  const {
    entriesIds,
    groupedCounts,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    isLoading,
    isOffline,
    error,
    isFetchNextPageError,
    insertedBefore,
  } = entries
  const stateValue: EntriesStateContextValue = useMemo(
    () => ({
      type: syncType,
      entriesIds,
      groupedCounts,
      hasNextPage,
      isFetchingNextPage,
      isFetching,
      isLoading,
      isOffline,
      error: error ?? null,
      isFetchNextPageError,
      view: view!,
      insertedBefore,
    }),
    [
      syncType,
      entriesIds,
      groupedCounts,
      hasNextPage,
      isFetchingNextPage,
      isFetching,
      isLoading,
      isOffline,
      error,
      isFetchNextPageError,
      view,
      insertedBefore,
    ],
  )

  const actionsValue: EntriesActionsContextValue = useMemo(
    () => ({
      fetchNextPage: fetchNextPageStable,
      refetch: refetchStable,
    }),
    [fetchNextPageStable, refetchStable],
  )

  return (
    <EntriesStateContext value={stateValue}>
      <EntriesActionsContext value={actionsValue}>{children}</EntriesActionsContext>
    </EntriesStateContext>
  )
}

export const useEntriesState = () => {
  const ctx = use(EntriesStateContext)
  if (!ctx) throw new Error("useEntriesState must be used within EntriesProvider")
  return ctx
}

export const useEntriesActions = () => {
  const ctx = use(EntriesActionsContext)
  if (!ctx) throw new Error("useEntriesActions must be used within EntriesProvider")
  return ctx
}
