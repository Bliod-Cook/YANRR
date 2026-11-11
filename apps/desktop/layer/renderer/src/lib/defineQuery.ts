import type { QueryFunction, QueryKey } from "@tanstack/react-query"

import { queryClient } from "./query-client"

export type DefinedQuery<TQueryKey extends QueryKey, TData> = Readonly<{
  key: TQueryKey
  fn: QueryFunction<TData>
  /** Marks the query stale and fetches it again, also where nothing shows it */
  invalidate: () => Promise<void>
}>

export const defineQuery = <
  TQueryKey extends QueryKey,
  TQueryFn extends QueryFunction<unknown>,
  TData = Awaited<ReturnType<TQueryFn>>,
>(
  key: TQueryKey,
  fn: TQueryFn,
): DefinedQuery<TQueryKey, TData> =>
  Object.freeze({
    key,
    fn: fn as QueryFunction<TData>,
    invalidate: () => queryClient.invalidateQueries({ queryKey: key, refetchType: "all" }),
  })
