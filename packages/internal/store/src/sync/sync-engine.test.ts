import { FeedViewType } from "@follow/constants"
import { db } from "@follow/database/db"
import { CollectionService } from "@follow/database/services/collection"
import { EntryService } from "@follow/database/services/entry"
import { FeedService } from "@follow/database/services/feed"
import { InboxService } from "@follow/database/services/inbox"
import { SubscriptionService } from "@follow/database/services/subscription"
import { SyncMetaService } from "@follow/database/services/sync-meta"
import { SyncTransactionService } from "@follow/database/services/sync-transaction"
import { UnreadService } from "@follow/database/services/unread"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FollowAPI } from "../api-contract"
import { apiContext, syncApiContext } from "../context"
import { collectionActions, useCollectionStore } from "../modules/collection/store"
import { entryActions, useEntryStore } from "../modules/entry/store"
import type { EntryModel } from "../modules/entry/types"
import { useInboxStore } from "../modules/inbox/store"
import {
  getConfirmedSubscriptionChange,
  subscriptionActions,
  subscriptionSyncService,
  useSubscriptionStore,
} from "../modules/subscription/store"
import type { SubscriptionModel } from "../modules/subscription/types"
import { unreadActions, unreadSyncService, useUnreadStore } from "../modules/unread/store"
import { useUserStore } from "../modules/user/store"
import { clearAccountInSession, startSessionCheck } from "./account"
import { registerSyncModel } from "./model-registry"
import { syncEngine } from "./sync-engine"
import { isSyncEngineActive } from "./sync-status"
import { transactionQueue } from "./transaction-queue"
import type { SyncAction, SyncAPI } from "./types"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

const { invalidateEntriesQueryMock, refreshEntriesHeadMock, setFeedUnreadDirtyMock } = vi.hoisted(
  () => ({
    invalidateEntriesQueryMock: vi.fn(),
    refreshEntriesHeadMock: vi.fn(async () => {}),
    setFeedUnreadDirtyMock: vi.fn(),
  }),
)

// The query cache and the UI state of the lists, which this test has none of
vi.mock("../modules/entry/hooks", () => ({
  invalidateEntriesQuery: invalidateEntriesQueryMock,
  refreshEntriesHead: refreshEntriesHeadMock,
}))
vi.mock("../modules/feed/hooks", () => ({
  setFeedUnreadDirty: setFeedUnreadDirtyMock,
  setFeedUnreadDirtyMany: (feedIds: Iterable<string>) => {
    for (const feedId of feedIds) setFeedUnreadDirtyMock(feedId)
  },
  clearFeedUnreadDirty: vi.fn(),
  clearAllFeedUnreadDirty: vi.fn(),
}))

const createEntry = (id: string, feedId: string, read = false): EntryModel => ({
  id,
  guid: `${id}-guid`,
  insertedAt: new Date("2026-01-01T00:00:00.000Z"),
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  feedId,
  read,
})

const feedSubscription = (feedId: string, view = FeedViewType.Articles): SubscriptionModel => ({
  feedId,
  inboxId: null,
  userId: "user-1",
  view,
  hideFromTimeline: null,
  title: null,
  category: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  type: "feed",
})

const createAction = (overrides: Partial<SyncAction> & Pick<SyncAction, "id">): SyncAction => ({
  model: "timeline",
  modelId: null,
  action: "U",
  data: null,
  createdAt: "2026-09-16T00:00:00.000Z",
  ...overrides,
})

const readAction = (id: number, entryIds: string[], feeds: Record<string, number>, read = true) =>
  createAction({ id, data: { entryIds, read, isInbox: false, feeds } })

const newEntriesAction = (id: number, feedId: string, unread: number, createdAt?: string) =>
  createAction({
    id,
    model: "timeline",
    modelId: feedId,
    action: "N",
    ...(createdAt && { createdAt }),
    data: {
      feedId,
      count: unread,
      unread,
      latestPublishedAt: "2026-09-16T00:00:00.000Z",
      from: ["feed"],
    },
  })

const seedEntries = (...entries: EntryModel[]) => entryActions.upsertMany(entries)

const seedUnread = (counts: Record<string, number>) =>
  unreadActions.upsertMany(
    Object.entries(counts).map(([id, count]) => ({ id, count })),
    { reset: true },
  )

const follow = (...subscriptions: SubscriptionModel[]) =>
  subscriptionActions.upsertMany(subscriptions)

/** A client that already bootstrapped and calibrated recently: pulls are purely incremental. */
const seedCursor = async (lastSyncId: number, calibratedAt = Date.now()) => {
  await SyncMetaService.set("lastSyncId", String(lastSyncId))
  await SyncMetaService.set("unreadCalibratedAt", String(calibratedAt))
  await SyncMetaService.set("subscriptionsCalibratedAt", String(calibratedAt))
}

const storedCursor = () => SyncMetaService.get("lastSyncId")

const storedUnread = async () =>
  Object.fromEntries((await UnreadService.getUnreadAll()).map(({ id, count }) => [id, count]))

const storedRead = async () =>
  Object.fromEntries(
    (await db.query.entriesTable.findMany({ columns: { id: true, read: true } })).map(
      ({ id, read }) => [id, read],
    ),
  )

const resetStores = () => {
  useEntryStore.setState(useEntryStore.getInitialState(), true)
  useSubscriptionStore.setState(useSubscriptionStore.getInitialState(), true)
  useCollectionStore.setState(useCollectionStore.getInitialState(), true)
  useInboxStore.setState(useInboxStore.getInitialState(), true)
  useUnreadStore.setState(useUnreadStore.getInitialState(), true)
  unreadActions.upsertManyInSession([], { reset: true })
}

/** The app quits and starts again on the same database. */
const restart = async () => {
  syncEngine.clearInSession()
  transactionQueue.clearInSession()
  resetStores()
  await Promise.all([
    subscriptionActions.hydrate(),
    unreadActions.hydrate(),
    entryActions.hydrate(),
    collectionActions.hydrate(),
  ])
  await transactionQueue.restore()
}

const deltaResponse = (
  actions: SyncAction[],
  options: { hasMore?: boolean; reset?: boolean; lastSyncId?: number } = {},
) => ({
  code: 0 as const,
  data: {
    actions,
    lastSyncId: options.lastSyncId ?? actions.at(-1)?.id ?? 0,
    hasMore: options.hasMore ?? false,
    reset: options.reset ?? false,
  },
})

describe("syncEngine", () => {
  const stateMock = vi.fn()
  const deltaMock = vi.fn()
  const subscriptionsGetMock = vi.fn()
  const readsGetMock = vi.fn()

  const provideApi = (extra: { reads?: object; subscriptions?: object } = {}) =>
    apiContext.provide({
      subscriptions: { get: subscriptionsGetMock, ...extra.subscriptions },
      reads: { get: readsGetMock, ...extra.reads },
    } as unknown as FollowAPI)

  beforeEach(async () => {
    vi.clearAllMocks()
    syncEngine.clearInSession()
    transactionQueue.clearInSession()
    await Promise.all([
      SyncMetaService.reset(),
      SyncTransactionService.reset(),
      EntryService.reset(),
      SubscriptionService.reset(),
      UnreadService.reset(),
      CollectionService.reset(),
      InboxService.reset(),
      FeedService.reset(),
    ])
    resetStores()

    useUserStore.setState((state) => ({ ...state, whoami: { id: "user-1" } as never }))
    clearAccountInSession()
    startSessionCheck().confirm("user-1")

    subscriptionsGetMock.mockResolvedValue({ code: 0, data: [] })
    readsGetMock.mockResolvedValue({ code: 0, data: {}, lastSyncId: 0 })
    provideApi()
    syncApiContext.provide({ state: stateMock, delta: deltaMock } as unknown as SyncAPI)
  })

  afterEach(() => {
    syncEngine.clearInSession()
    transactionQueue.clearInSession()
    vi.restoreAllMocks()
  })

  it("bootstraps on the first pull and stores the server's sync id", async () => {
    stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 42 } })
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 3 }, lastSyncId: 42 })

    await syncEngine.pull("launch")

    expect(stateMock).toHaveBeenCalledTimes(1)
    expect(subscriptionsGetMock).toHaveBeenCalledTimes(1)
    expect(readsGetMock).toHaveBeenCalledTimes(1)
    expect(deltaMock).not.toHaveBeenCalled()
    expect(syncEngine.getLastSyncId()).toBe(42)
    expect(await storedCursor()).toBe("42")
    expect(await storedUnread()).toEqual({ "feed-1": 3 })
    expect(isSyncEngineActive()).toBe(true)
  })

  it("bootstraps once someone is signed in after a launch without a session user", async () => {
    stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 42 } })
    // A fresh profile: nobody is known to be signed in until the session check answers
    useUserStore.setState((state) => ({ ...state, whoami: null }))
    vi.useFakeTimers()
    try {
      await syncEngine.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(stateMock).not.toHaveBeenCalled()

      useUserStore.setState((state) => ({ ...state, whoami: { id: "user-1" } as never }))
      // Well before the next interval pull
      await vi.advanceTimersByTimeAsync(100)
    } finally {
      vi.useRealTimers()
    }

    expect(stateMock).toHaveBeenCalledTimes(1)
    expect(syncEngine.getLastSyncId()).toBe(42)
  })

  it("applies the inbox lifecycle, new inbox entries and inbox entry deletions", async () => {
    await seedCursor(50)
    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        createAction({
          id: 51,
          model: "inbox",
          modelId: "news",
          action: "I",
          data: {
            inboxes: { type: "inbox", id: "news", secret: "s3cret", title: "News" },
            feedId: "inbox-news",
            title: "News",
            userId: "user-1",
            inboxId: "news",
            view: 0,
            category: null,
            hideFromTimeline: null,
            createdAt: "",
          },
        }),
        createAction({
          id: 52,
          model: "inbox",
          modelId: "news",
          action: "U",
          data: { title: "Daily" },
        }),
        createAction({
          id: 53,
          model: "timeline",
          modelId: "news",
          action: "N",
          data: {
            inboxId: "news",
            isInbox: true,
            count: 1,
            unread: 1,
            latestPublishedAt: "2026-09-17T00:00:00.000Z",
            from: ["inbox"],
          },
        }),
      ]),
    )

    await syncEngine.pull("interval")

    expect(useInboxStore.getState().inboxes.news).toMatchObject({
      id: "news",
      title: "Daily",
      secret: "s3cret",
    })
    expect(useSubscriptionStore.getState().data["inbox/news"]).toMatchObject({
      inboxId: "news",
      type: "inbox",
      title: "Daily",
    })
    expect(setFeedUnreadDirtyMock).toHaveBeenCalledWith("news")
    expect(useUnreadStore.getState().data.news).toBe(1)
    expect(readsGetMock).not.toHaveBeenCalled()

    await seedEntries({ ...createEntry("mail-1", "news"), inboxHandle: "news" })
    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        createAction({
          id: 54,
          model: "inbox_entry",
          modelId: "mail-1",
          action: "D",
          data: { inboxId: "news", unread: true },
        }),
        createAction({ id: 55, model: "inbox", modelId: "news", action: "D" }),
      ]),
    )
    await syncEngine.pull("interval")

    expect(useEntryStore.getState().data["mail-1"]).toBeUndefined()
    expect(await storedRead()).toEqual({})
    expect(useInboxStore.getState().inboxes.news).toBeUndefined()
    expect(useSubscriptionStore.getState().data["inbox/news"]).toBeUndefined()
    expect(await db.query.inboxesTable.findMany()).toEqual([])
    expect(await storedUnread()).toEqual({ news: 0 })
  })

  it("tells the transaction queue how far the change log was applied", async () => {
    await seedCursor(60)
    const markSyncedSpy = vi.spyOn(transactionQueue, "markSynced")
    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        createAction({ id: 61, model: "collection", modelId: "entry-9", action: "D" }),
      ]),
    )

    await syncEngine.pull("interval")

    expect(markSyncedSpy).toHaveBeenCalledWith(61)
  })

  it("applies subscription updates and deletes from the delta", async () => {
    await seedCursor(10)
    await follow(feedSubscription("feed-1"), feedSubscription("feed-2"))
    deltaMock.mockResolvedValue(
      deltaResponse([
        createAction({
          id: 11,
          model: "subscription",
          modelId: "feed-1",
          action: "U",
          data: { view: FeedViewType.Videos, category: "Clips" },
        }),
        createAction({ id: 12, model: "subscription", modelId: "feed-2", action: "D" }),
      ]),
    )

    await syncEngine.pull("interval")

    expect(deltaMock).toHaveBeenCalledWith({ lastSyncId: 10 })
    const state = useSubscriptionStore.getState()
    expect(state.data["feed-1"]?.view).toBe(FeedViewType.Videos)
    expect(state.data["feed-1"]?.category).toBe("Clips")
    expect(state.feedIdByView[FeedViewType.Videos].has("feed-1")).toBe(true)
    expect(state.feedIdByView[FeedViewType.Articles].has("feed-1")).toBe(false)
    expect(state.data["feed-2"]).toBeUndefined()
    expect(await db.query.subscriptionsTable.findMany()).toEqual([
      expect.objectContaining({ feedId: "feed-1", view: FeedViewType.Videos, category: "Clips" }),
    ])
    expect(await storedCursor()).toBe("12")
    expect(invalidateEntriesQueryMock).toHaveBeenCalledTimes(1)
    // Marks the lists only; fetching every loaded page again would also jump them to the top
    expect(invalidateEntriesQueryMock.mock.calls[0]).toEqual([
      expect.objectContaining({ refetch: false }),
    ])
  })

  it("keeps an unfollow and its undo against older rows that the delta still returns", async () => {
    await seedCursor(10)
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 10 }))
    await syncEngine.pull("interval")

    const feed = {
      type: "feed" as const,
      id: "feed-1",
      url: "https://example.com/feed.xml",
      title: "Example",
    }
    // Followed on this device at 11, which the cursor has not reached yet.
    subscriptionActions.upsertManyInSession([feedSubscription("feed-1")])
    const followRow = (id: number) =>
      createAction({
        id,
        model: "subscription",
        modelId: "feed-1",
        action: "I",
        data: { ...feedSubscription("feed-1"), feeds: feed },
      })
    provideApi({
      subscriptions: {
        delete: vi.fn(async () => ({ code: 0, lastSyncId: 12 })),
        create: vi.fn(async () => ({ code: 0, feed, unread: {}, lastSyncId: 13 })),
      },
    })

    await subscriptionSyncService.unsubscribe("feed-1")
    // The delta lags behind the unfollow and still returns the follow before it.
    deltaMock.mockResolvedValueOnce(deltaResponse([followRow(11)]))
    await syncEngine.pull("manual")
    expect(useSubscriptionStore.getState().data["feed-1"]).toBeUndefined()
    expect(syncEngine.getLastSyncId()).toBe(11)

    // Undo: the delta now returns the unfollow, but not the follow that undid it.
    await subscriptionSyncService.subscribe({
      url: feed.url,
      feedId: "feed-1",
      view: FeedViewType.Articles,
      category: null,
      hideFromTimeline: null,
      title: null,
    })
    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        createAction({ id: 12, model: "subscription", modelId: "feed-1", action: "D" }),
      ]),
    )
    await syncEngine.pull("manual")
    expect(useSubscriptionStore.getState().data["feed-1"]?.feedId).toBe("feed-1")
    expect(useSubscriptionStore.getState().feedIdByView[FeedViewType.Articles].has("feed-1")).toBe(
      true,
    )

    // Once the log caught up with both changes, rows from other devices apply again.
    deltaMock.mockResolvedValueOnce(deltaResponse([followRow(13)]))
    await syncEngine.pull("manual")
    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        createAction({ id: 14, model: "subscription", modelId: "feed-1", action: "D" }),
      ]),
    )
    await syncEngine.pull("manual")
    expect(useSubscriptionStore.getState().data["feed-1"]).toBeUndefined()
    expect(syncEngine.getLastSyncId()).toBe(14)
  })

  it("keeps a confirmed unfollow out of a subscription list read from a lagging replica", async () => {
    await seedCursor(10)
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 10 }))
    await syncEngine.pull("interval")

    await follow(feedSubscription("feed-1"))
    const feedRow = {
      ...feedSubscription("feed-1"),
      feeds: { id: "feed-1", url: "https://example.com/feed.xml", title: "Example" },
    }
    subscriptionsGetMock.mockResolvedValue({ code: 0, data: [feedRow] })
    provideApi({ subscriptions: { delete: vi.fn(async () => ({ code: 0, lastSyncId: 11 })) } })

    await subscriptionSyncService.unsubscribe("feed-1")
    await subscriptionSyncService.fetch()
    expect(useSubscriptionStore.getState().data["feed-1"]).toBeUndefined()

    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        createAction({ id: 11, model: "subscription", modelId: "feed-1", action: "D" }),
      ]),
    )
    await syncEngine.pull("manual")
    // The change log has the unfollow now, so the server's list is trusted again.
    await subscriptionSyncService.fetch()
    expect(useSubscriptionStore.getState().data["feed-1"]?.feedId).toBe("feed-1")
  })

  it("confirms nothing for a failed unfollow and keeps the cursor when the delta lags behind it", async () => {
    await seedCursor(20)
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 20 }))
    await syncEngine.pull("interval")

    await follow(feedSubscription("feed-2"))
    const deleteMock = vi.fn(async (): Promise<{ code: 0; lastSyncId: number }> => {
      throw new TypeError("Failed to fetch")
    })
    provideApi({ subscriptions: { delete: deleteMock } })

    // Offline: the unfollow is rolled back, and nothing overrides the change log
    await expect(subscriptionSyncService.unsubscribe("feed-2")).rejects.toThrow("Failed to fetch")
    expect(useSubscriptionStore.getState().data["feed-2"]?.feedId).toBe("feed-2")
    expect(getConfirmedSubscriptionChange("feed-2")).toBeUndefined()

    deleteMock.mockImplementation(async () => ({ code: 0, lastSyncId: 21 }))
    await subscriptionSyncService.unsubscribe("feed-2")
    expect(getConfirmedSubscriptionChange("feed-2")).toEqual({ subscription: null, syncId: 21 })

    // A replica behind the cursor answers with an older id: the cursor and the unfollow stay
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 18 }))
    await syncEngine.pull("manual")
    expect(syncEngine.getLastSyncId()).toBe(20)
    expect(getConfirmedSubscriptionChange("feed-2")).toBeDefined()

    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        createAction({ id: 21, model: "subscription", modelId: "feed-2", action: "D" }),
      ]),
    )
    await syncEngine.pull("manual")
    expect(deltaMock).toHaveBeenLastCalledWith({ lastSyncId: 20 })
    expect(syncEngine.getLastSyncId()).toBe(21)
    expect(getConfirmedSubscriptionChange("feed-2")).toBeUndefined()
    expect(useSubscriptionStore.getState().data["feed-2"]).toBeUndefined()
  })

  it("applies collection and read-state changes while pending local marks win", async () => {
    await seedCursor(20)
    await seedEntries(createEntry("entry1", "feed-1"), createEntry("entry2", "feed-1", true))
    await seedUnread({ "feed-1": 2 })
    provideApi({ reads: { markAsUnread: vi.fn(() => new Promise(() => {})) } })
    await unreadSyncService.markEntryAsUnread("entry2")

    deltaMock.mockResolvedValue(
      deltaResponse([
        createAction({
          id: 21,
          model: "collection",
          modelId: "entry1",
          action: "I",
          data: {
            entryId: "entry1",
            feedId: "feed-1",
            view: FeedViewType.Articles,
            createdAt: "2026-09-16T00:00:00.000Z",
          },
        }),
        readAction(22, ["entry1"], { "feed-1": 1 }),
        createAction({ id: 23, model: "collection", modelId: "entry1", action: "D" }),
      ]),
    )

    await syncEngine.pull("interval")

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useEntryStore.getState().data.entry2?.read).toBe(false)
    expect(await storedRead()).toEqual({ entry1: true, entry2: true })
    expect(useCollectionStore.getState().collections.entry1).toBeUndefined()
    expect(await db.query.collectionsTable.findMany()).toEqual([])
    // The flip of the change log, with the pending unread mark on top
    expect(await storedUnread()).toEqual({ "feed-1": 1 })
    expect(useUnreadStore.getState().data["feed-1"]).toBe(2)
    expect(readsGetMock).not.toHaveBeenCalled()
  })

  it("marks feeds dirty and counts new entries, paging through the delta", async () => {
    await seedCursor(30)
    await follow(feedSubscription("feed-1"))
    deltaMock
      .mockResolvedValueOnce(deltaResponse([newEntriesAction(31, "feed-1", 3)], { hasMore: true }))
      .mockResolvedValueOnce(deltaResponse([], { lastSyncId: 31 }))

    await syncEngine.pull("interval")

    expect(deltaMock).toHaveBeenCalledTimes(2)
    expect(deltaMock).toHaveBeenLastCalledWith({ lastSyncId: 31 })
    expect(setFeedUnreadDirtyMock).toHaveBeenCalledWith("feed-1")
    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
    expect(readsGetMock).not.toHaveBeenCalled()
    expect(invalidateEntriesQueryMock).not.toHaveBeenCalled()
  })

  it("applies a run of read actions with one store update and one write per read state", async () => {
    await seedCursor(100)
    const ids = Array.from({ length: 1200 }, (_, index) => `entry${index}`)
    await seedEntries(...ids.map((id) => createEntry(id, "feed-1")))
    await seedUnread({ "feed-1": 1200 })
    // Read one by one on another device
    deltaMock.mockResolvedValue(
      deltaResponse(ids.map((id, index) => readAction(101 + index, [id], { "feed-1": 1 }))),
    )
    const patchMany = vi.spyOn(EntryService, "patchMany")
    const storeUnread = vi.spyOn(UnreadService, "upsertMany")
    let entryUpdates = 0
    const unsubscribe = useEntryStore.subscribe(() => entryUpdates++)

    await syncEngine.pull("interval")
    unsubscribe()

    expect(ids.every((id) => useEntryStore.getState().data[id]?.read)).toBe(true)
    expect(entryUpdates).toBe(1)
    // More entries than one statement may bind
    const written = patchMany.mock.calls.map(([patch]) => patch.entryIds!)
    expect(written.every((chunk) => chunk.length <= 500)).toBe(true)
    expect(written.flat()).toEqual(ids)
    expect(Object.values(await storedRead()).every(Boolean)).toBe(true)
    expect(useUnreadStore.getState().data["feed-1"]).toBe(0)
    expect(storeUnread).toHaveBeenCalledTimes(1)
    expect(await storedUnread()).toEqual({ "feed-1": 0 })
  })

  it("keeps the last read state of an entry flipped back and forth", async () => {
    await seedCursor(110)
    await seedEntries(createEntry("entry1", "feed-1"))
    const flip = (id: number, read: boolean) => readAction(id, ["entry1"], { "feed-1": 1 }, read)
    deltaMock.mockResolvedValue(
      deltaResponse([flip(111, true), flip(112, false), flip(113, true), flip(114, false)]),
    )
    const patchMany = vi.spyOn(EntryService, "patchMany")

    await syncEngine.pull("interval")

    expect(useEntryStore.getState().data.entry1?.read).toBe(false)
    expect(patchMany).toHaveBeenCalledTimes(1)
    expect(await storedRead()).toEqual({ entry1: false })
  })

  it("moves counters step by step, as each step stops at zero, around new entries", async () => {
    await seedCursor(120)
    await follow(feedSubscription("feed-2"))
    await seedUnread({ "feed-1": 1, "feed-2": 1 })
    deltaMock.mockResolvedValue(
      deltaResponse([
        // feed-1: 1 - 3 stops at 0, then + 2; summing the run would give 0
        readAction(121, [], { "feed-1": 3, "feed-2": 3 }),
        readAction(122, [], { "feed-1": 2 }, false),
        newEntriesAction(123, "feed-2", 2),
        // feed-2: 0 + 2 - 1; taken with the reads before the new entries it would give 2
        readAction(124, [], { "feed-2": 1 }),
      ]),
    )

    await syncEngine.pull("interval")

    expect(useUnreadStore.getState().data).toMatchObject({ "feed-1": 2, "feed-2": 1 })
    expect(await storedUnread()).toEqual({ "feed-1": 2, "feed-2": 1 })
  })

  it("moves unread counters by what read actions report, without a recount", async () => {
    await seedCursor(70)
    await seedUnread({ "feed-1": 5, "feed-2": 2, news: 1 })
    await seedEntries(createEntry("entry1", "feed-1"))
    deltaMock.mockResolvedValue(
      deltaResponse([
        // entry9 was never loaded here: its feed is only known from `feeds`.
        readAction(71, ["entry1", "entry9"], { "feed-1": 1, "feed-2": 1 }),
        readAction(72, ["entry9"], { "feed-2": 1 }, false),
        createAction({
          id: 73,
          data: { entryIds: ["mail1"], read: true, isInbox: true, feeds: { news: 4 } },
        }),
      ]),
    )
    const storeUnread = vi.spyOn(UnreadService, "upsertMany")

    await syncEngine.pull("interval")

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useUnreadStore.getState().data).toMatchObject({
      "feed-1": 4,
      "feed-2": 2,
      // Never below zero, even when this client's counter had drifted.
      news: 0,
    })
    expect(readsGetMock).not.toHaveBeenCalled()
    expect(subscriptionsGetMock).not.toHaveBeenCalled()
    // One write for the whole page
    expect(storeUnread).toHaveBeenCalledTimes(1)
    expect(await storedUnread()).toEqual({ "feed-1": 4, "feed-2": 2, news: 0 })
  })

  it("adds new unread entries to the counters and only fetches the head of visible lists", async () => {
    await seedCursor(80)
    await follow(feedSubscription("feed-1", FeedViewType.Videos))
    await seedUnread({ "feed-1": 1 })

    deltaMock.mockResolvedValueOnce(
      deltaResponse([newEntriesAction(81, "feed-1", 2, "2026-09-16T08:00:00.000Z")]),
    )
    await syncEngine.pull("interval")

    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
    expect(setFeedUnreadDirtyMock).toHaveBeenCalledWith("feed-1")
    expect(readsGetMock).not.toHaveBeenCalled()
    // The user may be reading: a background pull leaves the lists alone.
    expect(refreshEntriesHeadMock).not.toHaveBeenCalled()

    deltaMock.mockResolvedValueOnce(
      deltaResponse([newEntriesAction(82, "feed-1", 0, "2026-09-16T08:00:00.000Z")]),
    )
    await syncEngine.pull("resume")

    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
    expect(refreshEntriesHeadMock).toHaveBeenCalledWith({
      views: expect.arrayContaining([FeedViewType.Videos, FeedViewType.All]),
      since: Date.parse("2026-09-16T08:00:00.000Z"),
    })
    expect(invalidateEntriesQueryMock).not.toHaveBeenCalled()
    expect(readsGetMock).not.toHaveBeenCalled()
  })

  it("applies new-entry counters in order with other actions and stores them once per page", async () => {
    await seedCursor(80)
    await follow(feedSubscription("feed-1"), feedSubscription("feed-2"))
    await seedUnread({ "feed-1": 1, "feed-2": 0 })
    const storeUnread = vi.spyOn(UnreadService, "upsertMany")

    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        newEntriesAction(81, "feed-1", 2),
        newEntriesAction(82, "feed-2", 3),
        newEntriesAction(83, "feed-1", 4),
        // Unfollowing sets the count outright, so the increments before it count first
        createAction({ id: 84, model: "subscription", modelId: "feed-2", action: "D" }),
        newEntriesAction(85, "feed-1", 1),
      ]),
    )
    await syncEngine.pull("interval")

    expect(useUnreadStore.getState().data["feed-1"]).toBe(8)
    expect(useUnreadStore.getState().data["feed-2"]).toBe(0)
    expect(setFeedUnreadDirtyMock).toHaveBeenCalledWith("feed-1")
    expect(setFeedUnreadDirtyMock).toHaveBeenCalledWith("feed-2")
    expect(storeUnread).toHaveBeenCalledTimes(1)
    expect(await storedUnread()).toEqual({ "feed-1": 8, "feed-2": 0 })
  })

  it("takes full snapshots again only when a calibration is due", async () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    await seedCursor(90, twoHoursAgo)
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 7 }, lastSyncId: 90 })
    deltaMock.mockResolvedValue(deltaResponse([], { lastSyncId: 90 }))

    await syncEngine.pull("interval")

    // Unread entries age out of the retention window without an action: recount hourly.
    expect(readsGetMock).toHaveBeenCalledTimes(1)
    expect(stateMock).not.toHaveBeenCalled()
    expect(useUnreadStore.getState().data["feed-1"]).toBe(7)
    // Feed metadata is refreshed daily, so two hours are not enough.
    expect(subscriptionsGetMock).not.toHaveBeenCalled()
    expect(Number(await SyncMetaService.get("unreadCalibratedAt"))).toBeGreaterThan(twoHoursAgo)

    await syncEngine.pull("interval")
    expect(readsGetMock).toHaveBeenCalledTimes(1)

    await seedCursor(90, Date.now() - 25 * 60 * 60 * 1000)
    syncEngine.clearInSession()
    await syncEngine.pull("interval")
    expect(readsGetMock).toHaveBeenCalledTimes(2)
    expect(subscriptionsGetMock).toHaveBeenCalledTimes(1)
  })

  it("does not add new-entry hints a recount already counted, even when they arrive later", async () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    await seedCursor(200, twoHoursAgo)
    await follow(feedSubscription("feed-1"))
    // The crawler logged four new entries at 201, but this poll is still answered from a
    // head published before that, so the hint is not delivered yet.
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 200 }))
    // The recount that follows already sees the four entries.
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 4 }, lastSyncId: 201 })

    await syncEngine.pull("interval")

    expect(useUnreadStore.getState().data["feed-1"]).toBe(4)
    expect(await SyncMetaService.get("unreadSnapshotSyncId")).toBe("201")

    // The user reads one of them; the next poll delivers the hint and the flip together.
    deltaMock.mockResolvedValueOnce(
      deltaResponse([
        newEntriesAction(201, "feed-1", 4),
        readAction(202, ["entry1"], { "feed-1": 1 }),
      ]),
    )
    await syncEngine.pull("interval")

    // Four minus one, not four plus four minus one.
    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
    expect(setFeedUnreadDirtyMock).toHaveBeenCalledWith("feed-1")
  })

  it("keeps the snapshot id of a recount across a restart", async () => {
    await seedCursor(300, Date.now() - 2 * 60 * 60 * 1000)
    await follow(feedSubscription("feed-1"))
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 300 }))
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 2 }, lastSyncId: 305 })

    await syncEngine.pull("interval")
    expect(await SyncMetaService.get("unreadSnapshotSyncId")).toBe("305")

    // A restart loads the id again: 305 is inside the snapshot, 306 is not.
    await restart()
    expect(useUnreadStore.getState().data["feed-1"]).toBe(2)
    deltaMock.mockResolvedValueOnce(
      deltaResponse([newEntriesAction(305, "feed-1", 2), newEntriesAction(306, "feed-1", 1)]),
    )
    await syncEngine.pull("interval")

    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
    expect(readsGetMock).toHaveBeenCalledTimes(1)
  })

  it("still flips read state and settles transactions for actions inside the snapshot", async () => {
    await seedCursor(400, Date.now() - 2 * 60 * 60 * 1000)
    await seedEntries(createEntry("entry1", "feed-1"))
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 400 }))
    // Another device read entry1 at 401, and the recount already reflects that.
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 1 }, lastSyncId: 401 })
    await syncEngine.pull("interval")
    expect(useUnreadStore.getState().data["feed-1"]).toBe(1)

    deltaMock.mockResolvedValueOnce(deltaResponse([readAction(401, ["entry1"], { "feed-1": 1 })]))
    await syncEngine.pull("interval")

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(await storedRead()).toEqual({ entry1: true })
    // The counter was not moved twice.
    expect(useUnreadStore.getState().data["feed-1"]).toBe(1)
  })

  it("lets callers rely on the local snapshot once a cursor exists", async () => {
    await seedCursor(100)
    deltaMock.mockResolvedValue(deltaResponse([], { lastSyncId: 100 }))

    expect(await syncEngine.ensureSynced()).toBe(true)
    // A second caller right after shares the pull that just finished.
    expect(await syncEngine.ensureSynced()).toBe(true)

    expect(deltaMock).toHaveBeenCalledTimes(1)
    expect(subscriptionsGetMock).not.toHaveBeenCalled()
    expect(readsGetMock).not.toHaveBeenCalled()
  })

  it("keeps answering from the local snapshot when a pull fails, and declines when signed out", async () => {
    await seedCursor(110)
    deltaMock.mockRejectedValueOnce(new Error("offline"))
    expect(await syncEngine.ensureSynced()).toBe(true)

    useUserStore.setState((state) => ({ ...state, whoami: null }))
    expect(await syncEngine.ensureSynced()).toBe(false)
  })

  it("drops the prediction of a local mark once the change log reports the real effect", async () => {
    await seedCursor(120)
    deltaMock.mockResolvedValue(deltaResponse([], { lastSyncId: 120 }))
    await syncEngine.pull("interval")

    await seedUnread({ "feed-1": 5 })
    await seedEntries(createEntry("entry1", "feed-1"))
    // Another device had marked the entry already, so the server flips nothing and answers
    // with the id of that device's action.
    provideApi({ reads: { markAsRead: vi.fn(async () => ({ code: 0, lastSyncId: 121 })) } })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    expect(useUnreadStore.getState().data["feed-1"]).toBe(4)
    await transactionQueue.flush()
    // Acknowledged, but the change log has not been read up to 121 yet.
    expect(useUnreadStore.getState().data["feed-1"]).toBe(4)
    expect(await storedUnread()).toEqual({ "feed-1": 5 })

    deltaMock.mockResolvedValue(deltaResponse([readAction(121, ["entry1"], { "feed-1": 1 })]))
    await syncEngine.pull("ack")

    // One flip in total, not the other device's plus this client's prediction.
    expect(useUnreadStore.getState().data["feed-1"]).toBe(4)
    expect(await storedUnread()).toEqual({ "feed-1": 4 })
    expect(readsGetMock).not.toHaveBeenCalled()
  })

  it("never shows its own flips taken off twice while the change log catches up", async () => {
    await seedCursor(120)
    deltaMock.mockResolvedValue(deltaResponse([], { lastSyncId: 120 }))
    await syncEngine.pull("interval")
    await seedUnread({ "feed-1": 5 })
    await seedEntries(createEntry("entry1", "feed-1"), createEntry("entry2", "feed-1"))
    provideApi({ reads: { markAsRead: vi.fn(async () => ({ code: 0, lastSyncId: 121 })) } })

    await unreadSyncService.markEntriesAsRead(["entry1", "entry2"])
    await transactionQueue.flush()
    const shown: number[] = []
    const unsubscribe = useUnreadStore.subscribe((state) => shown.push(state.data["feed-1"]!))
    deltaMock.mockResolvedValue(
      deltaResponse([readAction(121, ["entry1", "entry2"], { "feed-1": 2 })]),
    )
    await syncEngine.pull("ack")
    unsubscribe()

    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
    expect(shown.every((count) => count === 3)).toBe(true)
  })

  it("counts a mark acknowledged while the first bootstrap loads its snapshots once", async () => {
    // A fresh profile replays a mark from its outbox while the engine has no cursor yet.
    await seedUnread({ "feed-1": 19 })
    await seedEntries(createEntry("entry1", "feed-1"))
    provideApi({ reads: { markAsRead: vi.fn(async () => ({ code: 0, lastSyncId: 463 })) } })
    stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 457 } })
    // The snapshot is read before the server applied the mark.
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 19 }, lastSyncId: 457 })
    let releaseModels: () => void = () => {}
    const unregister = registerSyncModel("widget", {
      bootstrap: () =>
        new Promise<void>((resolve) => {
          releaseModels = resolve
        }),
      apply: vi.fn(),
    })

    const bootstrap = syncEngine.pull("launch")
    await vi.waitFor(() => expect(readsGetMock).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await transactionQueue.flush()
    expect(useUnreadStore.getState().data["feed-1"]).toBe(18)

    releaseModels()
    await bootstrap
    deltaMock.mockResolvedValue(deltaResponse([readAction(463, ["entry1"], { "feed-1": 1 })]))
    await syncEngine.pull("ack")

    // The server's count: the change log's flip, not that plus the prediction.
    expect(useUnreadStore.getState().data["feed-1"]).toBe(18)
    expect(await storedUnread()).toEqual({ "feed-1": 18 })
    unregister()
  })

  it("does not count a mark again on top of a first snapshot that already contains it", async () => {
    // A fresh profile replays a mark from its outbox while the engine has no cursor yet.
    await seedUnread({ "feed-1": 19 })
    await seedEntries(createEntry("entry1", "feed-1"))
    provideApi({ reads: { markAsRead: vi.fn(async () => ({ code: 0, lastSyncId: 463 })) } })
    stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 457 } })
    let releaseSubscriptions: () => void = () => {}
    subscriptionsGetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSubscriptions = () => resolve({ code: 0, data: [] })
        }),
    )
    // The server applied the mark before it counted the unread entries.
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 18 }, lastSyncId: 465 })

    const bootstrap = syncEngine.pull("launch")
    await vi.waitFor(() => expect(subscriptionsGetMock).toHaveBeenCalledTimes(1))

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await transactionQueue.flush()
    expect(useUnreadStore.getState().data["feed-1"]).toBe(18)

    releaseSubscriptions()
    await bootstrap
    // The snapshot holds the mark already, so the count is the server's at once.
    expect(useUnreadStore.getState().data["feed-1"]).toBe(18)

    deltaMock.mockResolvedValue(deltaResponse([readAction(463, ["entry1"], { "feed-1": 1 })]))
    await syncEngine.pull("ack")

    expect(useUnreadStore.getState().data["feed-1"]).toBe(18)
  })

  it("replays a mark made offline after a restart and counts it once", async () => {
    await seedCursor(130)
    await follow(feedSubscription("feed-1"))
    await seedEntries(createEntry("entry1", "feed-1"), createEntry("entry2", "feed-1"))
    await seedUnread({ "feed-1": 2 })
    const markAsRead = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
    provideApi({ reads: { markAsRead } })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await transactionQueue.flush()
    await restart()

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useUnreadStore.getState().data["feed-1"]).toBe(1)
    // The launch pull
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 130 }))
    await syncEngine.pull("launch")

    markAsRead.mockResolvedValue({ code: 0, lastSyncId: 131 })
    await transactionQueue.flush()
    deltaMock.mockResolvedValue(deltaResponse([readAction(131, ["entry1"], { "feed-1": 1 })]))
    await syncEngine.pull("ack")

    expect(useUnreadStore.getState().data["feed-1"]).toBe(1)
    expect(await storedUnread()).toEqual({ "feed-1": 1 })
    expect(await storedRead()).toEqual({ entry1: true, entry2: false })
    expect(await storedCursor()).toBe("131")
  })

  describe("when applying an action fails", () => {
    it("stops before it, keeps the cursor before it and starts with it again", async () => {
      await seedCursor(10)
      await follow(feedSubscription("feed-1"))
      const apply = vi.fn().mockRejectedValueOnce(new Error("quota exceeded"))
      const unregister = registerSyncModel("widget", { apply })
      const actions = [
        newEntriesAction(11, "feed-1", 1),
        createAction({ id: 12, model: "widget", modelId: "w1" }),
        newEntriesAction(13, "feed-1", 2),
      ]
      deltaMock
        .mockResolvedValueOnce(deltaResponse(actions))
        .mockResolvedValueOnce(deltaResponse(actions.slice(1)))

      await syncEngine.pull("interval")

      expect(await storedCursor()).toBe("11")
      expect(await storedUnread()).toEqual({ "feed-1": 1 })
      expect(useUnreadStore.getState().data["feed-1"]).toBe(1)

      await syncEngine.pull("interval")

      expect(deltaMock).toHaveBeenLastCalledWith({ lastSyncId: 11 })
      expect(apply).toHaveBeenCalledTimes(2)
      expect(await storedCursor()).toBe("13")
      expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
      unregister()
    })

    it("does not skip the action after read states it could not write", async () => {
      await seedCursor(20)
      await seedEntries(createEntry("entry1", "feed-1"), createEntry("entry2", "feed-1"))
      await seedUnread({ "feed-1": 2 })
      vi.spyOn(EntryService, "patchMany").mockRejectedValueOnce(new Error("database is locked"))
      deltaMock.mockResolvedValue(
        deltaResponse([
          readAction(21, ["entry1"], { "feed-1": 1 }),
          createAction({
            id: 22,
            model: "collection",
            modelId: "entry2",
            action: "I",
            data: {
              entryId: "entry2",
              feedId: "feed-1",
              view: FeedViewType.Articles,
              createdAt: "2026-09-16T00:00:00.000Z",
            },
          }),
        ]),
      )

      await syncEngine.pull("interval")

      expect(await storedCursor()).toBe("20")
      expect(useCollectionStore.getState().collections.entry2).toBeUndefined()
      expect(await storedUnread()).toEqual({ "feed-1": 2 })

      await syncEngine.pull("interval")

      expect(await storedCursor()).toBe("22")
      expect(await storedRead()).toEqual({ entry1: true, entry2: false })
      expect(useCollectionStore.getState().collections.entry2).toBeDefined()
      expect(await storedUnread()).toEqual({ "feed-1": 1 })
    })

    it("counts nothing twice when the cursor could not be stored", async () => {
      await seedCursor(40)
      await follow(feedSubscription("feed-1"))
      await seedUnread({ "feed-1": 1 })
      const set = SyncMetaService.set.bind(SyncMetaService)
      vi.spyOn(SyncMetaService, "set").mockImplementationOnce(async (key, value, tx) => {
        if (key === "lastSyncId") throw new Error("disk I/O error")
        await set(key, value, tx)
      })
      deltaMock.mockResolvedValue(deltaResponse([newEntriesAction(41, "feed-1", 2)]))

      await syncEngine.pull("interval")
      expect(await storedCursor()).toBe("40")
      expect(await storedUnread()).toEqual({ "feed-1": 1 })

      // The app quits before the next pull, which reads the log from the stored cursor.
      await restart()
      await syncEngine.pull("interval")

      expect(deltaMock).toHaveBeenLastCalledWith({ lastSyncId: 40 })
      expect(await storedCursor()).toBe("41")
      expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
      expect(await storedUnread()).toEqual({ "feed-1": 3 })
    })

    it("loads everything again once the same action failed three pulls in a row", async () => {
      await seedCursor(50)
      const unregister = registerSyncModel("widget", {
        apply: vi.fn().mockRejectedValue(new Error("unsupported rule")),
      })
      deltaMock.mockResolvedValue(
        deltaResponse([createAction({ id: 51, model: "widget", modelId: "w1" })]),
      )
      stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 60 } })

      await syncEngine.pull("interval")
      await syncEngine.pull("interval")
      expect(stateMock).not.toHaveBeenCalled()
      expect(await storedCursor()).toBe("50")

      await syncEngine.pull("interval")
      expect(stateMock).toHaveBeenCalledTimes(1)
      expect(subscriptionsGetMock).toHaveBeenCalledTimes(1)
      expect(await storedCursor()).toBe("60")
      unregister()
    })
  })

  it("starts counting the change log again after the server started it over", async () => {
    await seedCursor(500)
    await follow(feedSubscription("feed-1"))
    await SyncMetaService.set("unreadSnapshotSyncId", "600")
    // Restored from a backup: the log's head is below the client's cursor now.
    deltaMock.mockResolvedValueOnce(deltaResponse([], { reset: true, lastSyncId: 40 }))
    stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 40 } })
    subscriptionsGetMock.mockResolvedValue({
      code: 0,
      data: [
        {
          ...feedSubscription("feed-1"),
          feeds: { type: "feed", id: "feed-1", url: "https://example.com/feed.xml" },
        },
      ],
    })
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 2 }, lastSyncId: 40 })

    await syncEngine.pull("interval")
    expect(await storedCursor()).toBe("40")
    expect(await SyncMetaService.get("unreadSnapshotSyncId")).toBe("40")

    deltaMock.mockResolvedValueOnce(deltaResponse([newEntriesAction(41, "feed-1", 1)]))
    await syncEngine.pull("interval")
    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)

    // Also after a restart
    await restart()
    deltaMock.mockResolvedValueOnce(deltaResponse([newEntriesAction(42, "feed-1", 1)]))
    await syncEngine.pull("interval")
    expect(useUnreadStore.getState().data["feed-1"]).toBe(4)
  })

  it("leaves no counter to the new entries of a feed unfollowed here", async () => {
    await seedCursor(10)
    await follow(feedSubscription("feed-1"))
    provideApi({ subscriptions: { delete: vi.fn(async () => ({ code: 0, lastSyncId: 12 })) } })

    await subscriptionSyncService.unsubscribe("feed-1")
    // Logged before the unfollow
    deltaMock.mockResolvedValue(deltaResponse([newEntriesAction(11, "feed-1", 3)]))
    await syncEngine.pull("interval")

    expect(useUnreadStore.getState().data["feed-1"] ?? 0).toBe(0)
    expect(setFeedUnreadDirtyMock).not.toHaveBeenCalledWith("feed-1")
  })

  it("recounts for the UI only after the pull that is applying the change log", async () => {
    await seedCursor(70, Date.now() - 2 * 60_000)
    await follow(feedSubscription("feed-1"))
    await seedUnread({ "feed-1": 1 })
    let answer: (value: ReturnType<typeof deltaResponse>) => void = () => {}
    deltaMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    readsGetMock.mockResolvedValue({ code: 0, data: { "feed-1": 3 }, lastSyncId: 71 })

    const pulling = syncEngine.pull("interval")
    await vi.waitFor(() => expect(deltaMock).toHaveBeenCalledTimes(1))
    const recount = syncEngine.requestUnreadCalibration()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(readsGetMock).not.toHaveBeenCalled()

    answer(deltaResponse([newEntriesAction(71, "feed-1", 2)]))
    await pulling
    await recount

    expect(readsGetMock).toHaveBeenCalledTimes(1)
    expect(useUnreadStore.getState().data["feed-1"]).toBe(3)
  })

  it("pulls again after a running pull when catching up with a change of the server", async () => {
    await seedCursor(90)
    let answer: (value: ReturnType<typeof deltaResponse>) => void = () => {}
    deltaMock
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValueOnce(
        deltaResponse([
          createAction({ id: 92, model: "collection", modelId: "entry1", action: "D" }),
        ]),
      )

    const pulling = syncEngine.pull("interval")
    await vi.waitFor(() => expect(deltaMock).toHaveBeenCalledTimes(1))
    // An import finished on the server after the running pull read its last page.
    const caughtUp = syncEngine.catchUp()
    answer(deltaResponse([], { lastSyncId: 91 }))
    await pulling

    expect(await caughtUp).toBe(true)
    expect(deltaMock).toHaveBeenCalledTimes(2)
    expect(deltaMock).toHaveBeenLastCalledWith({ lastSyncId: 91 })
    expect(syncEngine.getLastSyncId()).toBe(92)
  })

  it("bootstraps a registered model once and hands it its actions", async () => {
    await seedCursor(130)
    const bootstrap = vi.fn(async () => {})
    const apply = vi.fn()
    const unregister = registerSyncModel("widget", { bootstrap, apply })

    const widgetAction = createAction({ id: 131, model: "widget", modelId: "w1", data: { n: 1 } })
    deltaMock.mockResolvedValueOnce(deltaResponse([widgetAction]))
    await syncEngine.pull("interval")

    expect(apply).toHaveBeenCalledWith(widgetAction)
    // The account had a cursor but never loaded this model: it is loaded in full once.
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(await SyncMetaService.get("bootstrapped:widget")).toBe("1")

    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 131 }))
    await syncEngine.pull("interval")
    expect(bootstrap).toHaveBeenCalledTimes(1)

    unregister()
  })

  it("loads a model in full again after its actions went by without a handler", async () => {
    await seedCursor(140)
    await SyncMetaService.set("bootstrapped:widget", "1")

    deltaMock.mockResolvedValueOnce(
      deltaResponse([createAction({ id: 141, model: "widget", modelId: "w1" })]),
    )
    await syncEngine.pull("interval")
    expect(await SyncMetaService.get("bootstrapped:widget")).toBeNull()

    const bootstrap = vi.fn(async () => {})
    const unregister = registerSyncModel("widget", { bootstrap, apply: vi.fn() })
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 141 }))
    await syncEngine.pull("interval")

    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(await SyncMetaService.get("bootstrapped:widget")).toBe("1")
    unregister()
  })

  it("loads registered models during the first bootstrap and retries a failed one", async () => {
    const bootstrap = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue()
    const unregister = registerSyncModel("widget", { bootstrap, apply: vi.fn() })
    stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 7 } })

    await syncEngine.pull("launch")
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(await SyncMetaService.get("bootstrapped:widget")).toBeNull()
    expect(syncEngine.getLastSyncId()).toBe(7)

    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 7 }))
    await syncEngine.pull("interval")
    expect(bootstrap).toHaveBeenCalledTimes(2)
    expect(await SyncMetaService.get("bootstrapped:widget")).toBe("1")
    unregister()
  })

  it("brings lists up to date on the next return for entries that arrived while reading", async () => {
    await seedCursor(150)
    await follow(feedSubscription("feed-1"))
    deltaMock.mockResolvedValueOnce(
      deltaResponse([newEntriesAction(151, "feed-1", 1, "2026-09-18T09:00:00.000Z")]),
    )
    await syncEngine.pull("interval")
    expect(refreshEntriesHeadMock).not.toHaveBeenCalled()

    // Nothing new in the log, but the entries from before are still owed to the lists.
    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 151 }))
    await syncEngine.pull("resume")

    expect(refreshEntriesHeadMock).toHaveBeenCalledTimes(1)
    expect(refreshEntriesHeadMock).toHaveBeenCalledWith({
      views: expect.arrayContaining([FeedViewType.Articles, FeedViewType.All]),
      since: Date.parse("2026-09-18T09:00:00.000Z"),
    })

    deltaMock.mockResolvedValueOnce(deltaResponse([], { lastSyncId: 151 }))
    syncEngine.clearInSession()
    await syncEngine.pull("resume")
    expect(refreshEntriesHeadMock).toHaveBeenCalledTimes(1)
  })

  describe("on return to the app", () => {
    const newEntries = (id: number) => newEntriesAction(id, "feed-1", 1, "2026-09-18T09:00:00.000Z")

    beforeEach(async () => {
      await follow(feedSubscription("feed-1"))
    })

    it("brings lists up to date after a pull that is still running", async () => {
      await seedCursor(200)
      let answer: (value: ReturnType<typeof deltaResponse>) => void = () => {}
      deltaMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      const pulling = syncEngine.pull("interval")
      await vi.waitFor(() => expect(deltaMock).toHaveBeenCalledTimes(1))

      syncEngine.resume()
      answer(deltaResponse([newEntries(201)]))
      await pulling
      await vi.waitFor(() => expect(refreshEntriesHeadMock).toHaveBeenCalledTimes(1))
    })

    it("brings lists up to date right after a pull, without asking for the delta again", async () => {
      await seedCursor(210)
      deltaMock.mockResolvedValueOnce(deltaResponse([newEntries(211)]))
      await syncEngine.pull("ack")
      expect(refreshEntriesHeadMock).not.toHaveBeenCalled()

      syncEngine.resume()

      await vi.waitFor(() => expect(refreshEntriesHeadMock).toHaveBeenCalledTimes(1))
      expect(deltaMock).toHaveBeenCalledTimes(1)
    })

    it("keeps the views owed when fetching the new entries failed", async () => {
      await seedCursor(220)
      deltaMock.mockResolvedValueOnce(deltaResponse([newEntries(221)]))
      await syncEngine.pull("interval")
      refreshEntriesHeadMock.mockRejectedValueOnce(new Error("offline"))

      syncEngine.resume()
      await vi.waitFor(() => expect(refreshEntriesHeadMock).toHaveBeenCalledTimes(1))
      await Promise.resolve()
      syncEngine.resume()

      await vi.waitFor(() => expect(refreshEntriesHeadMock).toHaveBeenCalledTimes(2))
      expect((refreshEntriesHeadMock.mock.calls as unknown as [unknown][])[1]?.[0]).toEqual(
        expect.objectContaining({ views: expect.arrayContaining([FeedViewType.Articles]) }),
      )
    })

    it("still fetches new entries for a view whose lists the same pull invalidated", async () => {
      await seedCursor(230)
      deltaMock.mockResolvedValueOnce(
        deltaResponse([
          newEntries(231),
          createAction({ id: 232, model: "subscription", modelId: "feed-1", action: "D" }),
        ]),
      )
      await syncEngine.pull("interval")

      syncEngine.resume()

      await vi.waitFor(() => expect(refreshEntriesHeadMock).toHaveBeenCalledTimes(1))
    })
  })

  it("bootstraps again when the server asks for a reset", async () => {
    await seedCursor(5)
    deltaMock.mockResolvedValue(deltaResponse([], { reset: true, lastSyncId: 5 }))
    stateMock.mockResolvedValue({ code: 0, data: { lastSyncId: 99 } })

    await syncEngine.pull("interval")

    expect(stateMock).toHaveBeenCalledTimes(1)
    expect(subscriptionsGetMock).toHaveBeenCalledTimes(1)
    expect(syncEngine.getLastSyncId()).toBe(99)
  })
})
