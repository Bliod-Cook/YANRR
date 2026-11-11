import type { QueryKey, UseQueryOptions, UseQueryResult } from "@tanstack/react-query"
import { useQuery } from "@tanstack/react-query"

import type { DefinedQuery } from "~/lib/defineQuery"
import { useIsSignedOut } from "~/queries/session"

/** A query that waits while the login modal asks the user to sign in again */
export function useAuthQuery<
  TQuery extends DefinedQuery<QueryKey, any>,
  TError = Error,
  TQueryFnData = Awaited<ReturnType<TQuery["fn"]>>,
  TData = TQueryFnData,
>(
  query: TQuery,
  options: Omit<UseQueryOptions<TQueryFnData, TError>, "queryKey" | "queryFn"> = {},
): UseQueryResult<TData, TError> & { key: TQuery["key"]; fn: TQuery["fn"] } {
  const isSignedOut = useIsSignedOut()
  // @ts-expect-error
  return Object.assign(
    {},
    useQuery({
      ...options,
      queryKey: query.key,
      queryFn: query.fn,
      enabled: !isSignedOut && (options.enabled ?? true),
    }),
    {
      key: query.key,
      fn: query.fn,
    },
  )
}
