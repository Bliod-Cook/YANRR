import { FeedViewType } from "@follow/constants"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { apiContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useCollectionStore } from "../collection/store"
import { useFeedStore } from "../feed/store"
import { debouncedFetchEntryContentByStream, entrySyncServices, useEntryStore } from "./store"

const {
  collectionDeleteManyMock,
  collectionUpsertManyMock,
  entryGetManyMock,
  entryUpsertManyMock,
  feedUpsertManyMock,
} = vi.hoisted(() => ({
  collectionDeleteManyMock: vi.fn(),
  collectionUpsertManyMock: vi.fn(),
  entryGetManyMock: vi.fn(),
  entryUpsertManyMock: vi.fn(),
  feedUpsertManyMock: vi.fn(),
}))

vi.mock("@follow/database/services/collection", () => ({
  CollectionService: {
    deleteMany: collectionDeleteManyMock,
    getCollectionAll: vi.fn(),
    reset: vi.fn(),
    upsertMany: collectionUpsertManyMock,
  },
}))

vi.mock("@follow/database/services/entry", () => ({
  EntryService: {
    getEntryMany: entryGetManyMock,
    getEntriesToHydrate: vi.fn(),
    upsertMany: entryUpsertManyMock,
  },
}))

vi.mock("@follow/database/services/feed", () => ({
  FeedService: {
    getFeedAll: vi.fn(),
    reset: vi.fn(),
    upsertMany: feedUpsertManyMock,
  },
}))

const createCollectionResponseItem = (index: number, view?: FeedViewType) => ({
  read: true,
  feeds: {
    id: "feed-1",
    title: "Feed",
    url: "https://example.com/feed.xml",
    image: null,
    description: null,
    ownerUserId: null,
    errorAt: null,
    errorMessage: null,
    siteUrl: "https://example.com",
  },
  entries: {
    id: `entry-${index}`,
    title: `Entry ${index}`,
    url: `https://example.com/${index}`,
    description: null,
    guid: `entry-${index}`,
    author: null,
    authorUrl: null,
    authorAvatar: null,
    insertedAt: "2026-03-01T00:00:00.000Z",
    publishedAt: "2026-02-01T00:00:00.000Z",
    media: null,
    categories: null,
    attachments: null,
    extra: null,
    language: null,
  },
  collections: {
    createdAt: `2026-03-${String(index).padStart(2, "0")}T00:00:00.000Z`,
    view,
  },
})

describe("entrySyncServices.fetchEntries", () => {
  const inboxListEntriesMock = vi.fn()
  const listEntriesMock = vi.fn()
  const pageParam = { time: "2026-03-01T00:00:00.000Z", id: "entry-1" }

  beforeEach(() => {
    vi.clearAllMocks()
    entryGetManyMock.mockResolvedValue([])
    entryUpsertManyMock.mockImplementation(async () => {})
    collectionUpsertManyMock.mockImplementation(async () => {})
    collectionDeleteManyMock.mockImplementation(async () => {})
    feedUpsertManyMock.mockImplementation(async () => {})

    useEntryStore.setState({
      data: {},
      entryIdByView: {
        [FeedViewType.All]: new Set(),
        [FeedViewType.Articles]: new Set(),
        [FeedViewType.Audios]: new Set(),
        [FeedViewType.Notifications]: new Set(),
        [FeedViewType.Pictures]: new Set(),
        [FeedViewType.SocialMedia]: new Set(),
        [FeedViewType.Videos]: new Set(),
      },
      entryIdByCategory: {},
      entryIdByFeed: {},
      entryIdByInbox: {},
      entryIdSet: new Set(),
    })
    useCollectionStore.setState({ collections: {} })
    useFeedStore.setState({ feeds: {} })
    apiContext.provide({
      entries: {
        inbox: {
          list: inboxListEntriesMock,
        },
        list: listEntriesMock,
      },
    } as unknown as FollowAPI)
  })

  it("keeps known collection entries when the first collection page can have more pages", async () => {
    useCollectionStore.setState({
      collections: Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => {
          const entryId = `entry-${index + 1}`
          return [
            entryId,
            {
              entryId,
              feedId: "feed-1",
              view: FeedViewType.Articles,
              createdAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
            },
          ]
        }),
      ),
    })
    listEntriesMock.mockResolvedValue({
      data: Array.from({ length: 20 }, (_, index) => createCollectionResponseItem(index + 6)),
    })

    await entrySyncServices.fetchEntries({
      feedId: "collections",
      view: FeedViewType.Articles,
      limit: 20,
    })

    expect(Object.keys(useCollectionStore.getState().collections)).toHaveLength(25)
    expect(useCollectionStore.getState().collections["entry-1"]).toBeDefined()
  })

  it("keeps the view an entry was starred in when another timeline lists it", async () => {
    const starred = { entryId: "entry-2", feedId: "feed-1", view: FeedViewType.Articles }
    useCollectionStore.setState({ collections: { "entry-2": { ...starred, createdAt: null } } })
    listEntriesMock.mockResolvedValue({
      data: [
        createCollectionResponseItem(1, FeedViewType.Pictures),
        // Without the view, only the time it was starred is known
        createCollectionResponseItem(2),
        createCollectionResponseItem(3),
      ],
    })

    await entrySyncServices.fetchEntries({ view: FeedViewType.All })

    expect(useCollectionStore.getState().collections).toEqual({
      "entry-1": {
        entryId: "entry-1",
        feedId: "feed-1",
        view: FeedViewType.Pictures,
        createdAt: "2026-03-01T00:00:00.000Z",
      },
      "entry-2": { ...starred, createdAt: "2026-03-02T00:00:00.000Z" },
    })
  })

  it("uses the forward cursor when entries are sorted oldest first", async () => {
    listEntriesMock.mockResolvedValue({ data: [] })

    await entrySyncServices.fetchEntries({
      feedId: "feed-1",
      read: false,
      pageParam,
      sortOrder: "asc",
    })

    expect(listEntriesMock.mock.calls[0]?.[0]).toMatchObject({
      feedId: "feed-1",
      publishedBefore: "2026-03-01T00:00:00.000Z",
      cursorId: "entry-1",
      sortOrder: "asc",
    })
    expect(listEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("publishedAfter")
  })

  it("forces all-content timelines to newest first", async () => {
    listEntriesMock.mockResolvedValue({ data: [] })

    await entrySyncServices.fetchEntries({
      feedId: "feed-1",
      pageParam,
      sortOrder: "asc",
    })

    expect(listEntriesMock.mock.calls[0]?.[0]).toMatchObject({
      feedId: "feed-1",
      publishedAfter: "2026-03-01T00:00:00.000Z",
      cursorId: "entry-1",
      sortOrder: "desc",
    })
    expect(listEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("publishedBefore")
  })

  it("uses the backward cursor when entries are sorted newest first", async () => {
    listEntriesMock.mockResolvedValue({ data: [] })

    await entrySyncServices.fetchEntries({
      feedId: "feed-1",
      pageParam,
      sortOrder: "desc",
    })

    expect(listEntriesMock.mock.calls[0]?.[0]).toMatchObject({
      feedId: "feed-1",
      publishedAfter: "2026-03-01T00:00:00.000Z",
      cursorId: "entry-1",
      sortOrder: "desc",
    })
    expect(listEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("publishedBefore")
  })

  it("forces inbox entries to newest first", async () => {
    inboxListEntriesMock.mockResolvedValue({ data: [] })

    await entrySyncServices.fetchEntries({
      inboxId: "inbox-1",
      read: false,
      pageParam,
      sortOrder: "asc",
    })

    expect(inboxListEntriesMock.mock.calls[0]?.[0]).toMatchObject({
      inboxId: "inbox-1",
      publishedAfter: "2026-03-01T00:00:00.000Z",
      cursorId: "entry-1",
    })
    expect(inboxListEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("publishedBefore")
    expect(inboxListEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("sortOrder")
  })

  it("uses the backward cursor when inbox entries are sorted newest first", async () => {
    inboxListEntriesMock.mockResolvedValue({ data: [] })

    await entrySyncServices.fetchEntries({
      inboxId: "inbox-1",
      pageParam,
      sortOrder: "desc",
    })

    expect(inboxListEntriesMock.mock.calls[0]?.[0]).toMatchObject({
      inboxId: "inbox-1",
      publishedAfter: "2026-03-01T00:00:00.000Z",
      cursorId: "entry-1",
    })
    expect(inboxListEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("publishedBefore")
    expect(inboxListEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("sortOrder")
  })

  it("forces collection queries to newest first", async () => {
    listEntriesMock.mockResolvedValue({ data: [] })

    await entrySyncServices.fetchEntries({
      isCollection: true,
      read: false,
      pageParam,
      sortOrder: "asc",
    })

    expect(listEntriesMock.mock.calls[0]?.[0]).toMatchObject({
      isCollection: true,
      publishedAfter: "2026-03-01T00:00:00.000Z",
      cursorId: "entry-1",
      sortOrder: "desc",
    })
    expect(listEntriesMock.mock.calls[0]?.[0]).not.toHaveProperty("publishedBefore")
  })
})

describe("entrySyncServices.fetchEntryContentByStream", () => {
  const entriesWithoutContent = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}-${index}`)
  const store = (ids: string[]) => {
    useEntryStore.setState({
      data: Object.fromEntries(
        ids.map((id) => [id, { id, guid: id, insertedAt: new Date(), publishedAt: new Date() }]),
      ),
    })
  }
  const streamApi = () => {
    // The server has no content for any of them, as for an entry that only has a title
    const stream = vi.fn(async (_: { ids: string[] }) => new Response("", { status: 200 }))
    apiContext.provide({ entries: { stream } } as unknown as FollowAPI)
    return stream
  }

  it("moves on to later entries once the first ones came back without content", async () => {
    const ids = entriesWithoutContent("title-only", 40)
    store(ids)
    const stream = streamApi()

    await entrySyncServices.fetchEntryContentByStream(ids)
    await entrySyncServices.fetchEntryContentByStream(ids)

    expect(stream.mock.calls.map(([body]) => body.ids)).toEqual([ids.slice(0, 30), ids.slice(30)])
  })

  it("does not ask twice for entries a request in flight asks for", async () => {
    const ids = entriesWithoutContent("in-flight", 10)
    store(ids)
    const stream = streamApi()

    await Promise.all([
      entrySyncServices.fetchEntryContentByStream(ids),
      entrySyncServices.fetchEntryContentByStream(ids),
    ])

    expect(stream).toHaveBeenCalledTimes(1)
  })

  it("asks again for entries whose request failed", async () => {
    const ids = entriesWithoutContent("failed", 3)
    store(ids)
    const stream = streamApi()
    stream.mockResolvedValueOnce(new Response("", { status: 503 }))

    await entrySyncServices.fetchEntryContentByStream(ids)
    await entrySyncServices.fetchEntryContentByStream(ids)

    expect(stream).toHaveBeenCalledTimes(2)
  })

  it("is prefetched through the debounced export", async () => {
    const ids = entriesWithoutContent("debounced", 3)
    store(ids)
    const stream = streamApi()

    debouncedFetchEntryContentByStream(ids)
    await debouncedFetchEntryContentByStream.flush()

    expect(stream).toHaveBeenCalledTimes(1)
  })
})

describe("entrySyncServices.fetchEntryDetail", () => {
  const id = "1328554886337265664"
  const { feeds, entries } = createCollectionResponseItem(1)
  const getEntryMock = vi.fn()

  beforeEach(() => {
    useEntryStore.setState({ data: {}, entryIdSet: new Set() })
    apiContext.provide({ entries: { get: getEntryMock } } as unknown as FollowAPI)
  })

  it("stores the read state the server reports, keeping the known one when it reports none", async () => {
    getEntryMock.mockResolvedValue({ data: { feeds, entries: { ...entries, id }, read: true } })
    await entrySyncServices.fetchEntryDetail(id)
    expect(useEntryStore.getState().data[id]?.read).toBe(true)

    getEntryMock.mockResolvedValue({ data: { feeds, entries: { ...entries, id } } })
    expect((await entrySyncServices.fetchEntryDetail(id))?.read).toBe(true)
  })
})

describe("entrySyncServices.searchEntries", () => {
  const listEntriesMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useEntryStore.setState({ data: {}, entryIdSet: new Set() })
    apiContext.provide({ entries: { list: listEntriesMock } } as unknown as FollowAPI)
  })

  it("asks the server for a page of matches in a timeline without touching the store", async () => {
    const highlight = { title: ["", "Rust", " news"], snippet: ["On ", "async", ""] }
    const feedItem = { ...createCollectionResponseItem(1), highlight }
    const inboxItem = {
      ...createCollectionResponseItem(2),
      feeds: { type: "inbox", id: "news", title: "News" },
    }
    listEntriesMock.mockResolvedValue({ data: [feedItem, inboxItem] })

    const results = await entrySyncServices.searchEntries({
      keyword: "rust",
      pageParam: { time: "2026-03-01T00:00:00.000Z", id: "entry-0" },
      scope: { view: FeedViewType.Articles, feedIdList: ["feed-1", "feed-2"] },
    })

    expect(listEntriesMock).toHaveBeenCalledWith({
      keyword: "rust",
      limit: 20,
      publishedAfter: "2026-03-01T00:00:00.000Z",
      cursorId: "entry-0",
      view: FeedViewType.Articles,
      feedIdList: ["feed-1", "feed-2"],
    })
    expect(results.map(({ entry }) => [entry.id, entry.feedId, entry.inboxHandle])).toEqual([
      ["entry-1", "feed-1", null],
      ["entry-2", "news", "news"],
    ])
    // Where they come from, followed or not
    expect(results.map(({ source }) => source?.title)).toEqual(["Feed", "News"])
    expect(results.map((result) => result.highlight)).toEqual([
      highlight,
      { title: [results[1]?.entry.title], snippet: null },
    ])
    expect(useEntryStore.getState().data).toEqual({})
  })
})
