import { FeedViewType } from "@follow/constants"
import { queryClientContext } from "@follow/store/context"
import {
  invalidateEntriesQuery,
  refreshEntriesHead,
  useEntriesQuery,
} from "@follow/store/entry/hooks"
import { entrySyncServices } from "@follow/store/entry/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

type EntriesResponse = Awaited<ReturnType<typeof entrySyncServices.fetchEntries>>

const createEntriesResponse = (
  entryId: string,
  publishedAt: string,
  collectionCreatedAt?: string,
) =>
  ({
    data: [
      {
        entries: {
          id: entryId,
          publishedAt,
        },
        ...(collectionCreatedAt && {
          collections: {
            createdAt: collectionCreatedAt,
          },
        }),
      },
    ],
  }) as unknown as EntriesResponse

describe("useEntriesQuery", () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let queryClient: QueryClient | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    ;(
      globalThis.window as typeof globalThis.window & {
        removeEventListener?: typeof globalThis.window.removeEventListener
      }
    ).removeEventListener ||= () => {}
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }

    queryClient?.clear()
    container?.remove()
    root = null
    container = null
    queryClient = null
    vi.restoreAllMocks()
  })

  test("coalesces repeated next-page requests while one is still in flight", async () => {
    const pendingPageResolvers: Array<(value: EntriesResponse) => void> = []
    const fetchEntriesSpy = vi
      .spyOn(entrySyncServices, "fetchEntries")
      .mockImplementation(async (props) => {
        if (props.pageParam) {
          return new Promise<EntriesResponse>((resolve) => {
            pendingPageResolvers.push(resolve)
          })
        }

        return createEntriesResponse("entry-1", "2026-05-14T00:00:00.000Z")
      })

    let entriesQuery: ReturnType<typeof useEntriesQuery> | undefined
    const EntriesQueryConsumer = () => {
      entriesQuery = useEntriesQuery({
        feedId: "collections",
        view: FeedViewType.Articles,
        limit: 1,
      })

      return null
    }

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <EntriesQueryConsumer />
        </QueryClientProvider>,
      )
    })

    await act(async () => {
      await vi.waitFor(() => {
        expect(entriesQuery?.isSuccess).toBe(true)
      })
    })

    let firstFetch: Promise<unknown> | undefined
    let secondFetch: Promise<unknown> | undefined
    await act(async () => {
      firstFetch = entriesQuery?.fetchNextPage()
      secondFetch = entriesQuery?.fetchNextPage()
      await Promise.resolve()
    })

    expect(fetchEntriesSpy).toHaveBeenCalledTimes(2)
    expect(pendingPageResolvers).toHaveLength(1)

    await act(async () => {
      pendingPageResolvers[0]?.(createEntriesResponse("entry-2", "2026-05-13T00:00:00.000Z"))
      await Promise.allSettled([firstFetch, secondFetch])
    })

    await act(async () => {
      await vi.waitFor(() => {
        expect(entriesQuery?.entriesIds).toEqual(["entry-1", "entry-2"])
      })
    })

    await act(async () => {
      firstFetch = entriesQuery?.fetchNextPage()
      secondFetch = entriesQuery?.fetchNextPage()
      await Promise.resolve()
    })

    expect(fetchEntriesSpy).toHaveBeenCalledTimes(3)
    expect(pendingPageResolvers).toHaveLength(2)

    await act(async () => {
      pendingPageResolvers[1]?.(createEntriesResponse("entry-3", "2026-05-12T00:00:00.000Z"))
      await Promise.allSettled([firstFetch, secondFetch])
    })
  })

  test("loads the end page of a short list asked for while it was refreshed", async () => {
    let resolveRefresh: ((value: EntriesResponse) => void) | undefined
    let firstPageRequests = 0
    const fetchEntriesSpy = vi
      .spyOn(entrySyncServices, "fetchEntries")
      .mockImplementation(async (props) => {
        if (props.pageParam) {
          return { data: [] } as unknown as EntriesResponse
        }

        firstPageRequests++
        if (firstPageRequests === 1) {
          return createEntriesResponse("entry-1", "2026-05-14T00:00:00.000Z")
        }
        return new Promise<EntriesResponse>((resolve) => {
          resolveRefresh = resolve
        })
      })
    const nextPageRequests = () =>
      fetchEntriesSpy.mock.calls.filter(([props]) => props.pageParam).length

    let entriesQuery: ReturnType<typeof useEntriesQuery> | undefined
    const EntriesQueryConsumer = () => {
      entriesQuery = useEntriesQuery({
        feedId: "feed-1",
        view: FeedViewType.Articles,
        // A full page, so the list asks for the page after it
        limit: 1,
      })

      return null
    }

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    queryClientContext.provide(queryClient)

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <EntriesQueryConsumer />
        </QueryClientProvider>,
      )
    })
    await vi.waitFor(() => {
      expect(entriesQuery?.isSuccess).toBe(true)
    })

    // A list whose last page is full ends with an empty page
    await act(async () => {
      await entriesQuery?.fetchNextPage()
    })
    await vi.waitFor(() => {
      expect(entriesQuery?.hasNextPage).toBe(false)
    })
    expect(nextPageRequests()).toBe(1)

    // A refresh starts over from the first page, which has a next page again
    let refresh: Promise<unknown> | undefined
    await act(async () => {
      refresh = entriesQuery?.refetch()
    })
    await vi.waitFor(() => {
      expect(entriesQuery?.isFetching).toBe(true)
    })
    expect(entriesQuery?.hasNextPage).toBe(true)

    // Asked for meanwhile, the next page would join the refresh and load nothing. It is asked
    // for again once the refresh is done, so the list reaches its end.
    let nextPage: Promise<unknown> | undefined
    await act(async () => {
      nextPage = entriesQuery?.fetchNextPage()
    })
    expect(nextPageRequests()).toBe(1)
    await act(async () => {
      resolveRefresh?.(createEntriesResponse("entry-1", "2026-05-14T00:00:00.000Z"))
      await Promise.all([refresh, nextPage])
    })
    await vi.waitFor(() => {
      expect(entriesQuery?.hasNextPage).toBe(false)
    })
    expect(nextPageRequests()).toBe(2)
  })

  test("uses collection created time as next-page cursor for starred entries", async () => {
    const fetchEntriesSpy = vi
      .spyOn(entrySyncServices, "fetchEntries")
      .mockImplementation(async (props) => {
        if (props.pageParam) {
          return createEntriesResponse("entry-2", "2026-02-27T00:00:00.000Z")
        }

        return createEntriesResponse(
          "entry-1",
          "2026-02-28T00:00:00.000Z",
          "2026-03-02T00:00:00.000Z",
        )
      })

    let entriesQuery: ReturnType<typeof useEntriesQuery> | undefined
    const EntriesQueryConsumer = () => {
      entriesQuery = useEntriesQuery({
        feedId: "collections",
        view: FeedViewType.Articles,
        limit: 1,
      })

      return null
    }

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <EntriesQueryConsumer />
        </QueryClientProvider>,
      )
    })

    await act(async () => {
      await vi.waitFor(() => {
        expect(entriesQuery?.isSuccess).toBe(true)
      })
    })

    await act(async () => {
      await entriesQuery?.fetchNextPage()
    })

    await vi.waitFor(() => {
      expect(fetchEntriesSpy).toHaveBeenCalledTimes(2)
    })
    expect(fetchEntriesSpy.mock.calls[1]?.[0].pageParam).toEqual({
      time: "2026-03-02T00:00:00.000Z",
      id: "entry-1",
    })
  })

  test("uses newest-first cache and request order for all-content timelines", async () => {
    const fetchEntriesSpy = vi
      .spyOn(entrySyncServices, "fetchEntries")
      .mockResolvedValue(createEntriesResponse("entry-1", "2026-05-14T00:00:00.000Z"))

    let entriesQuery: ReturnType<typeof useEntriesQuery> | undefined
    const EntriesQueryConsumer = ({ sortOrder }: { sortOrder: "asc" | "desc" }) => {
      entriesQuery = useEntriesQuery({
        feedId: "feed-1",
        sortOrder,
      })

      return null
    }

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <EntriesQueryConsumer sortOrder="asc" />
        </QueryClientProvider>,
      )
    })

    await vi.waitFor(() => {
      expect(entriesQuery?.isSuccess).toBe(true)
    })
    expect(entriesQuery?.queryKey.at(-1)).toBe("desc")
    expect(fetchEntriesSpy.mock.calls[0]?.[0].sortOrder).toBe("desc")

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <EntriesQueryConsumer sortOrder="desc" />
        </QueryClientProvider>,
      )
    })

    expect(fetchEntriesSpy).toHaveBeenCalledTimes(1)
    expect(entriesQuery?.queryKey.at(-1)).toBe("desc")
  })

  test("isolates unread timeline pages by effective sort order", async () => {
    const fetchEntriesSpy = vi
      .spyOn(entrySyncServices, "fetchEntries")
      .mockResolvedValue(createEntriesResponse("entry-1", "2026-05-14T00:00:00.000Z"))

    let entriesQuery: ReturnType<typeof useEntriesQuery> | undefined
    const EntriesQueryConsumer = ({ sortOrder }: { sortOrder: "asc" | "desc" }) => {
      entriesQuery = useEntriesQuery({
        feedId: "feed-1",
        unreadOnly: true,
        sortOrder,
      })

      return null
    }

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <EntriesQueryConsumer sortOrder="desc" />
        </QueryClientProvider>,
      )
    })

    await vi.waitFor(() => {
      expect(entriesQuery?.isSuccess).toBe(true)
    })
    expect(entriesQuery?.queryKey.at(-1)).toBe("desc")

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <EntriesQueryConsumer sortOrder="asc" />
        </QueryClientProvider>,
      )
    })

    await vi.waitFor(() => {
      expect(fetchEntriesSpy).toHaveBeenCalledTimes(2)
      expect(entriesQuery?.queryKey.at(-1)).toBe("asc")
    })
  })
})

describe("useEntriesQuery paging and refetching", () => {
  let root: Root | null = null
  let client: QueryClient

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client.clear()
    Reflect.deleteProperty(globalThis.history, "isPop")
    vi.restoreAllMocks()
  })

  const page = (ids: string[]) =>
    ({
      data: ids.map((id) => ({
        entries: {
          id,
          publishedAt: `2026-05-${String(30 - Number(id.slice(1))).padStart(2, "0")}T00:00:00.000Z`,
        },
      })),
    }) as unknown as EntriesResponse

  type Props = Parameters<typeof useEntriesQuery>[0]
  let entriesQuery: ReturnType<typeof useEntriesQuery> | undefined
  const Consumer = ({ props }: { props: Props }) => {
    entriesQuery = useEntriesQuery(props)
    return null
  }

  const render = async (props: Props) => {
    root ??= createRoot(document.createElement("div"))
    await act(async () =>
      root?.render(
        <QueryClientProvider client={client}>
          <Consumer props={props} />
        </QueryClientProvider>,
      ),
    )
    await vi.waitFor(() => expect(entriesQuery?.isFetching).toBe(false))
  }

  const remount = async (props: Props) => {
    await act(async () => root?.unmount())
    root = null
    await render(props)
  }

  /** Answers one entry per page: e0, e1, … */
  const serveOneEntryPages = () =>
    vi
      .spyOn(entrySyncServices, "fetchEntries")
      .mockImplementation(async ({ pageParam }) =>
        page([pageParam ? `e${Number(pageParam.id.slice(1)) + 1}` : "e0"]),
      )

  const setup = () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClientContext.provide(client)
  }

  const articles = { feedId: "feed-1", view: FeedViewType.Articles, limit: 1 }

  const loadFivePages = async (props: Props) => {
    await render(props)
    for (let i = 1; i < 5; i++) {
      await act(async () => {
        await entriesQuery?.fetchNextPage()
      })
    }
    await vi.waitFor(() => expect(entriesQuery?.entriesIds).toEqual(["e0", "e1", "e2", "e3", "e4"]))
  }

  test("ends a list at a short page without asking for an empty one", async () => {
    setup()
    const fetch = vi.spyOn(entrySyncServices, "fetchEntries").mockResolvedValue(page(["e0", "e1"]))

    await render({ feedId: "feed-1", view: FeedViewType.Articles, limit: 3 })

    expect(entriesQuery?.hasNextPage).toBe(false)
    await render({ feedId: "feed-2", view: FeedViewType.Articles })
    // Without a limit the server answers 20 per page
    expect(entriesQuery?.hasNextPage).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test("leaves a list as it is when a sync invalidates it in the background", async () => {
    setup()
    const fetch = serveOneEntryPages()
    await loadFivePages(articles)
    fetch.mockClear()

    await act(async () => {
      await invalidateEntriesQuery({ views: [FeedViewType.Articles], refetch: false })
    })

    // Give a refetch, had one started, the time to reach the server
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(fetch).not.toHaveBeenCalled()
    expect(entriesQuery?.entriesIds).toHaveLength(5)
  })

  test("fetches only the first page of an invalidated list entered again", async () => {
    setup()
    const fetch = serveOneEntryPages()
    await loadFivePages(articles)
    await act(async () => {
      await invalidateEntriesQuery({ views: [FeedViewType.Articles], refetch: false })
    })
    fetch.mockClear()

    await remount(articles)

    await vi.waitFor(() => expect(entriesQuery?.entriesIds).toEqual(["e0"]))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0].pageParam).toBeUndefined()
  })

  test("fetches only the first page of a list seen over 10 minutes ago, when switched back to", async () => {
    setup()
    const fetch = serveOneEntryPages()
    await loadFivePages(articles)
    const other = { ...articles, feedId: "feed-2" }
    await render(other)
    const key = client.getQueryCache().findAll({ queryKey: ["entries", "feed-1"] })[0]!.queryKey
    client.setQueryData(key, client.getQueryData(key), { updatedAt: Date.now() - 11 * 60_000 })
    fetch.mockClear()

    await render(articles)

    await vi.waitFor(() => expect(entriesQuery?.entriesIds).toEqual(["e0"]))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("keeps deep pages when going back", async () => {
    setup()
    const fetch = serveOneEntryPages()
    await loadFivePages(articles)
    await act(async () => {
      await invalidateEntriesQuery({ views: [FeedViewType.Articles], refetch: false })
    })
    fetch.mockClear()
    ;(globalThis.history as History & { isPop?: boolean }).isPop = true

    await remount(articles)

    // Give a refetch, had one started, the time to reach the server
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(fetch).not.toHaveBeenCalled()
    expect(entriesQuery?.entriesIds).toHaveLength(5)
  })

  test("asks an oldest-first list read to its end for entries that arrived since", async () => {
    setup()
    const unreadOldestFirst = { ...articles, limit: 2, unreadOnly: true, sortOrder: "asc" as const }
    const fetch = vi
      .spyOn(entrySyncServices, "fetchEntries")
      .mockImplementation(async ({ pageParam }) => (pageParam ? page(["e1"]) : page(["e0"])))
    await render(unreadOldestFirst)
    expect(entriesQuery?.hasNextPage).toBe(false)

    await act(async () => {
      await refreshEntriesHead({ views: [FeedViewType.Articles] })
    })

    expect(fetch.mock.calls.at(-1)?.[0].pageParam?.id).toBe("e0")
    await vi.waitFor(() => expect(entriesQuery?.entriesIds).toEqual(["e0", "e1"]))
  })
})
