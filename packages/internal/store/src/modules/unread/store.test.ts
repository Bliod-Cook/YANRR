import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { FeedViewType } from "@follow/constants"
import { db } from "@follow/database/db"
import { EntryService } from "@follow/database/services/entry"
import { SubscriptionService } from "@follow/database/services/subscription"
import { SyncTransactionService } from "@follow/database/services/sync-transaction"
import { UnreadService } from "@follow/database/services/unread"
import { FollowAPIError, FollowClient } from "@follow-app/client-sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiContext } from "../../context"
import { clearAccountInSession, startSessionCheck } from "../../sync/account"
import type { SyncEngineHandle } from "../../sync/sync-status"
import { registerSyncEngine, setSyncEngineActive } from "../../sync/sync-status"
import { transactionQueue } from "../../sync/transaction-queue"
import type { FollowAPI } from "../../types"
import { entryActions, useEntryStore } from "../entry/store"
import type { EntryModel } from "../entry/types"
import { unreadActions, unreadSyncService, useUnreadStore } from "./store"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

/** Counters as the server confirmed them, which is what a hydrated client starts from. */
const seedUnread = (counts: Record<string, number>) =>
  unreadActions.upsertMany(
    Object.entries(counts).map(([id, count]) => ({ id, count })),
    { reset: true },
  )

const storedUnread = async () =>
  Object.fromEntries((await UnreadService.getUnreadAll()).map(({ id, count }) => [id, count]))

const storedRead = async () =>
  Object.fromEntries(
    (await db.query.entriesTable.findMany({ columns: { id: true, read: true } })).map(
      ({ id, read }) => [id, read],
    ),
  )

const flushQueue = async () => {
  await vi.advanceTimersByTimeAsync(100)
  await transactionQueue.whenIdle()
}

/** The app quits and starts again on the same database. */
const restart = async () => {
  transactionQueue.clearInSession()
  useEntryStore.setState(useEntryStore.getInitialState(), true)
  useUnreadStore.setState(useUnreadStore.getInitialState(), true)
  await Promise.all([entryActions.hydrate(), unreadActions.hydrate()])
  await transactionQueue.restore()
}

const createEntry = (
  id: string,
  feedId: string,
  read = false,
  publishedAt = new Date("2026-01-01T00:00:00.000Z"),
): EntryModel => ({
  id,
  guid: `${id}-guid`,
  insertedAt: new Date("2026-01-01T00:00:00.000Z"),
  publishedAt,
  feedId,
  read,
})

const seedEntries = (...entries: EntryModel[]) => entryActions.upsertMany(entries)

/** Followed feeds keep their entries when the app starts */
const follow = (...feedIds: string[]) =>
  SubscriptionService.upsertMany(
    feedIds.map((feedId) => ({
      id: `feed/${feedId}`,
      feedId,
      userId: "user-1",
      view: FeedViewType.Articles,
      type: "feed" as const,
    })),
  )

describe("unreadSyncService", () => {
  const markAsReadMock = vi.fn()
  const markAllAsReadMock = vi.fn()
  const markAsUnreadMock = vi.fn()
  const getUnreadMock = vi.fn()

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    transactionQueue.clearInSession()
    // Signed in as the account the local data belongs to.
    clearAccountInSession()
    startSessionCheck().confirm("user-1")

    await Promise.all([
      EntryService.reset(),
      UnreadService.reset(),
      SyncTransactionService.reset(),
      SubscriptionService.reset(),
    ])
    useEntryStore.setState(useEntryStore.getInitialState(), true)
    await seedUnread({})
    apiContext.provide({
      reads: {
        markAllAsRead: markAllAsReadMock,
        markAsRead: markAsReadMock,
        markAsUnread: markAsUnreadMock,
        get: getUnreadMock,
      },
    } as unknown as FollowAPI)
  })

  afterEach(() => {
    transactionQueue.clearInSession()
    setSyncEngineActive(false)
    vi.useRealTimers()
  })

  it("marks multiple feed entries as read with one request and one local patch", async () => {
    await seedEntries(createEntry("entry1", "feed1"), createEntry("entry2", "feed1"))
    await seedUnread({ feed1: 2 })
    markAsReadMock.mockResolvedValue({ code: 0 })

    await unreadSyncService.markEntriesAsRead(["entry1", "entry2"])
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useUnreadStore.getState().data.feed1).toBe(0)
    expect(markAsReadMock).not.toHaveBeenCalled()

    await flushQueue()

    expect(markAsReadMock).toHaveBeenCalledTimes(1)
    expect(markAsReadMock).toHaveBeenCalledWith({
      entryIds: ["entry1", "entry2"],
      isInbox: false,
    })
    expect(await storedRead()).toEqual({ entry1: true, entry2: true })
    expect(useUnreadStore.getState().data.feed1).toBe(0)
  })

  it("optimistically decrements unread count for time-limited batch reads", async () => {
    await seedEntries(
      createEntry("entry1", "feed1", false, new Date("2026-01-01T00:05:00.000Z")),
      createEntry("entry2", "feed1", false, new Date("2026-01-01T00:03:00.000Z")),
      createEntry("entry3", "feed1", false, new Date("2026-01-01T00:01:00.000Z")),
    )
    await seedUnread({ feed1: 3 })

    let resolveMarkAllAsRead!: (value: unknown) => void
    markAllAsReadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMarkAllAsRead = resolve
      }),
    )
    const time = {
      startTime: new Date("2026-01-01T00:02:00.000Z").getTime(),
      endTime: new Date("2026-01-01T00:06:00.000Z").getTime(),
    }

    await unreadSyncService.markBatchAsRead({
      view: FeedViewType.Articles,
      filter: { feedIdList: ["feed1"] },
      time,
    })

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useEntryStore.getState().data.entry2?.read).toBe(true)
    expect(useEntryStore.getState().data.entry3?.read).toBe(false)
    expect(useUnreadStore.getState().data.feed1).toBe(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(markAllAsReadMock).toHaveBeenCalledTimes(1)
    expect(markAllAsReadMock).toHaveBeenCalledWith({
      view: FeedViewType.Articles,
      feedIdList: ["feed1"],
      ...time,
    })
    resolveMarkAllAsRead({ code: 0, data: { read: { feed1: 2 } } })
    await transactionQueue.whenIdle()

    expect(useUnreadStore.getState().data.feed1).toBe(1)
    expect(await storedUnread()).toEqual({ feed1: 1 })
    expect(await storedRead()).toEqual({ entry1: true, entry2: true, entry3: false })
  })

  it("queues rapid read marks into one batched request", async () => {
    await seedEntries(createEntry("entry1", "feed1"), createEntry("entry2", "feed1"))
    await seedUnread({ feed1: 2 })
    markAsReadMock.mockResolvedValue({ code: 0 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await unreadSyncService.markEntriesAsRead(["entry2"])

    expect(markAsReadMock).not.toHaveBeenCalled()

    await flushQueue()

    expect(markAsReadMock).toHaveBeenCalledTimes(1)
    expect(markAsReadMock).toHaveBeenCalledWith({
      entryIds: ["entry1", "entry2"],
      isInbox: false,
    })
  })

  it("keeps optimistic read marks and retries when the network is down", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 1 })
    markAsReadMock
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValue({ code: 0 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(0)

    expect(markAsReadMock).toHaveBeenCalledTimes(1)
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useUnreadStore.getState().data.feed1).toBe(0)
    expect(await storedRead()).toEqual({ entry1: false })

    await vi.advanceTimersByTimeAsync(1000)
    await transactionQueue.whenIdle()

    expect(markAsReadMock).toHaveBeenCalledTimes(2)
    expect(await storedRead()).toEqual({ entry1: true })
  })

  it("replays a read mark the server did not answer before the app quit", async () => {
    await follow("feed1")
    await seedEntries(createEntry("entry1", "feed1"), createEntry("entry2", "feed1"))
    await seedUnread({ feed1: 2 })
    markAsReadMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await vi.advanceTimersByTimeAsync(100)
    await restart()

    // Hydrated from the database, which holds the confirmed state, with the mark on top
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useUnreadStore.getState().data.feed1).toBe(1)

    markAsReadMock.mockResolvedValue({ code: 0 })
    await flushQueue()
    expect(markAsReadMock).toHaveBeenLastCalledWith({ entryIds: ["entry1"], isInbox: false })
    expect(await storedRead()).toEqual({ entry1: true, entry2: false })
    expect(await storedUnread()).toEqual({ feed1: 1 })
  })

  it("keeps a read mark through a gateway's error page and a sign-in page", async () => {
    const answers = [
      { status: 403, type: "text/html", body: "<h1>Forbidden</h1>" },
      { status: 200, type: "text/html", body: "<!doctype html><title>Sign in</title>" },
      { status: 200, type: "application/json", body: JSON.stringify({ code: 0 }) },
    ]
    const requests: unknown[] = []
    const server: Server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      requests.push(JSON.parse(Buffer.concat(chunks).toString()))
      const answer = answers.shift()!
      response.writeHead(answer.status, { "content-type": answer.type })
      response.end(answer.body)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    apiContext.provide(
      new FollowClient({ baseURL: `http://127.0.0.1:${port}`, fetch }).api as unknown as FollowAPI,
    )
    // Real requests need real timers; each flush sends at once instead of after the back-off.
    vi.useRealTimers()
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 1 })

    try {
      await unreadSyncService.markEntriesAsRead(["entry1"])
      await transactionQueue.flush()
      await transactionQueue.flush()
      expect(requests).toHaveLength(2)
      expect(useEntryStore.getState().data.entry1?.read).toBe(true)
      expect(await storedRead()).toEqual({ entry1: false })

      await transactionQueue.flush()
      expect(requests).toEqual([
        { entryIds: ["entry1"], isInbox: false },
        { entryIds: ["entry1"], isInbox: false },
        { entryIds: ["entry1"], isInbox: false },
      ])
      expect(await storedRead()).toEqual({ entry1: true })
      expect(useUnreadStore.getState().data.feed1).toBe(0)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it("rolls back read marks the server rejects", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 1 })
    markAsReadMock.mockRejectedValue(
      new FollowAPIError("forbidden", 403, undefined, undefined, { serverCode: 1000 }),
    )

    await unreadSyncService.markEntriesAsRead(["entry1"])
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    expect(useUnreadStore.getState().data.feed1).toBe(0)

    await flushQueue()

    expect(useEntryStore.getState().data.entry1?.read).toBe(false)
    expect(useUnreadStore.getState().data.feed1).toBe(1)
    expect(await storedRead()).toEqual({ entry1: false })
  })

  it("restores the counts and entries of a mark-all-read the server rejects", async () => {
    await seedEntries(createEntry("entry1", "feed1"), createEntry("entry2", "feed1"))
    await seedUnread({ feed1: 17, feed2: 3 })
    markAllAsReadMock.mockRejectedValue(
      new FollowAPIError("unprocessable", 422, undefined, undefined, { serverCode: 1000 }),
    )

    await unreadSyncService.markFeedAsRead("feed1")
    expect(useUnreadStore.getState().data.feed1).toBe(0)

    await flushQueue()

    expect(useUnreadStore.getState().data).toEqual({ feed1: 17, feed2: 3 })
    expect(useEntryStore.getState().data.entry1?.read).toBe(false)
    expect(useEntryStore.getState().data.entry2?.read).toBe(false)
    expect(getUnreadMock).not.toHaveBeenCalled()
  })

  it("commits the predicted effect when the server has no change log", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 3 })
    markAsReadMock.mockResolvedValue({ code: 0 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await flushQueue()

    expect(useUnreadStore.getState().data.feed1).toBe(2)
    expect(await storedUnread()).toEqual({ feed1: 2 })

    // Releasing the acknowledged transaction later must not apply or undo it again.
    await vi.advanceTimersByTimeAsync(31_000)
    transactionQueue.getOverlays()
    expect(useUnreadStore.getState().data.feed1).toBe(2)
  })

  it("leaves the counters to the change log when the server numbered the mark", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 3 })
    setSyncEngineActive(true)
    markAsReadMock.mockResolvedValue({ code: 0, lastSyncId: 12 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await flushQueue()

    // Still shown as read by this client, but nothing was written as confirmed state.
    expect(useUnreadStore.getState().data.feed1).toBe(2)
    expect(await storedUnread()).toEqual({ feed1: 3 })

    // The change log reports the flip, and the engine moves its cursor past it.
    unreadActions.confirm({ feed1: 2 })
    transactionQueue.markSynced(12)
    unreadActions.syncDisplayedCounts(["feed1"])

    expect(useUnreadStore.getState().data.feed1).toBe(2)
  })

  it("restores the counter when the server reports that a mark flipped nothing", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 3 })
    setSyncEngineActive(true)
    markAsReadMock.mockResolvedValue({ code: 0, lastSyncId: 12 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await flushQueue()
    expect(useUnreadStore.getState().data.feed1).toBe(2)

    // The entry was outside the retention window: no action, so the confirmed count stands.
    transactionQueue.markSynced(12)

    expect(useUnreadStore.getState().data.feed1).toBe(3)
  })

  describe("marking everything as read", () => {
    const clickedAt = new Date("2026-03-01T08:00:00.000Z").getTime()

    beforeEach(() => {
      vi.setSystemTime(clickedAt)
    })

    it("only covers the entries that had arrived when it was asked for", async () => {
      await seedUnread({ feed1: 12, feed2: 4 })
      markAllAsReadMock.mockResolvedValue({ code: 0, data: { read: { feed1: 12 } } })

      await unreadSyncService.markFeedAsRead("feed1")
      expect(useUnreadStore.getState().data).toEqual({ feed1: 0, feed2: 4 })
      // Sent an hour later, as after a tunnel or a flight
      vi.setSystemTime(clickedAt + 60 * 60_000)
      await flushQueue()

      expect(markAllAsReadMock).toHaveBeenCalledWith({
        feedIdList: ["feed1"],
        insertedBefore: clickedAt,
      })
    })

    it("keeps that bound when it is replayed after a restart", async () => {
      await follow("feed1")
      await seedEntries(createEntry("entry1", "feed1"))
      await seedUnread({ feed1: 1 })
      markAllAsReadMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

      await unreadSyncService.markFeedAsRead("feed1")
      await vi.advanceTimersByTimeAsync(100)
      vi.setSystemTime(clickedAt + 60 * 60_000)
      await restart()
      // An entry that arrived after the gesture is not covered by it.
      await seedEntries({ ...createEntry("entry2", "feed1"), insertedAt: new Date() })

      expect(useEntryStore.getState().data.entry1?.read).toBe(true)
      expect(useEntryStore.getState().data.entry2?.read).toBe(false)
      markAllAsReadMock.mockResolvedValue({ code: 0, data: { read: { feed1: 1 } } })
      await flushQueue()

      expect(markAllAsReadMock).toHaveBeenLastCalledWith({
        feedIdList: ["feed1"],
        insertedBefore: clickedAt,
      })
      expect(await storedRead()).toEqual({ entry1: true, entry2: false })
    })

    it("leaves the counts to the change log when the server numbered it", async () => {
      await seedUnread({ feed1: 12, feed2: 4 })
      setSyncEngineActive(true)
      markAllAsReadMock.mockResolvedValue({
        code: 0,
        data: { read: { feed1: 10 } },
        lastSyncId: 20,
      })

      await unreadSyncService.markFeedAsRead("feed1")
      await flushQueue()

      expect(useUnreadStore.getState().data).toEqual({ feed1: 0, feed2: 4 })
      // Two entries arrived before the request did, so the server still counts them.
      expect(await storedUnread()).toEqual({ feed1: 12, feed2: 4 })
      unreadActions.confirm({ feed1: 2 })
      transactionQueue.markSynced(20)
      expect(useUnreadStore.getState().data).toEqual({ feed1: 2, feed2: 4 })
    })

    it("takes off what the server reports when no change log will", async () => {
      await seedUnread({ feed1: 12, feed2: 4 })
      markAllAsReadMock.mockResolvedValue({ code: 0, data: { read: { feed1: 10 } } })

      await unreadSyncService.markFeedAsRead("feed1")
      await flushQueue()

      expect(await storedUnread()).toEqual({ feed1: 2, feed2: 4 })
      await vi.advanceTimersByTimeAsync(31_000)
      transactionQueue.getOverlays()
      expect(useUnreadStore.getState().data).toEqual({ feed1: 2, feed2: 4 })
    })
  })

  it("rebases pending read marks on top of unread counts fetched from the server", async () => {
    await seedEntries(createEntry("entry1", "feed1"), createEntry("entry2", "feed2"))
    await seedUnread({ feed1: 3, feed2: 1 })
    markAsReadMock.mockReturnValue(new Promise(() => {}))
    getUnreadMock.mockResolvedValue({
      code: 0,
      data: { feed1: 3, feed2: 1, feed3: 4 },
      lastSyncId: 1,
    })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    expect(useUnreadStore.getState().data.feed1).toBe(2)

    await unreadSyncService.resetFromRemote()

    expect(useUnreadStore.getState().data).toEqual({ feed1: 2, feed2: 1, feed3: 4 })
    expect(await storedUnread()).toEqual({ feed1: 3, feed2: 1, feed3: 4 })
  })

  it("keeps entries locally read when a stale entry fetch returns during the request", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 1 })

    let resolveMarkAsRead!: () => void
    markAsReadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMarkAsRead = () => resolve({ code: 0 })
      }),
    )

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await vi.advanceTimersByTimeAsync(100)
    expect(markAsReadMock).toHaveBeenCalledTimes(1)

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
    entryActions.upsertManyInSession([createEntry("entry1", "feed1")])
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)

    resolveMarkAsRead()
    await transactionQueue.whenIdle()

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
  })

  it("keeps entries locally read when a stale entry fetch returns after the request", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 1 })
    markAsReadMock.mockResolvedValue({ code: 0 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await flushQueue()
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)

    entryActions.upsertManyInSession([createEntry("entry1", "feed1")])

    expect(useEntryStore.getState().data.entry1?.read).toBe(true)
  })

  it("allows remote unread after the acknowledgement grace window expires", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 1 })
    markAsReadMock.mockResolvedValue({ code: 0 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await flushQueue()
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)

    vi.advanceTimersByTime(31_000)
    entryActions.upsertManyInSession([createEntry("entry1", "feed1")])

    expect(useEntryStore.getState().data.entry1?.read).toBe(false)
  })

  it("stops protecting a read mark once the sync engine passed its sync id", async () => {
    await seedEntries(createEntry("entry1", "feed1"))
    await seedUnread({ feed1: 1 })
    markAsReadMock.mockResolvedValue({ code: 0, lastSyncId: 12 })

    await unreadSyncService.markEntriesAsRead(["entry1"])
    await flushQueue()

    entryActions.upsertManyInSession([createEntry("entry1", "feed1")])
    expect(useEntryStore.getState().data.entry1?.read).toBe(true)

    transactionQueue.markSynced(12)
    entryActions.upsertManyInSession([createEntry("entry1", "feed1")])
    expect(useEntryStore.getState().data.entry1?.read).toBe(false)
  })

  it("keeps a pending unread mark when a stale fetch says the entry is read", async () => {
    await seedEntries(createEntry("entry1", "feed1", true))
    await seedUnread({ feed1: 0 })
    markAsUnreadMock.mockReturnValue(new Promise(() => {}))

    await unreadSyncService.markEntryAsUnread("entry1")
    expect(useEntryStore.getState().data.entry1?.read).toBe(false)
    expect(useUnreadStore.getState().data.feed1).toBe(1)

    entryActions.upsertManyInSession([createEntry("entry1", "feed1", true)])
    expect(useEntryStore.getState().data.entry1?.read).toBe(false)
  })

  describe("with the sync engine", () => {
    const engine = (): SyncEngineHandle & {
      requestUnreadCalibration: ReturnType<typeof vi.fn>
      recordUnreadSnapshot: ReturnType<typeof vi.fn>
    } => ({
      ensureSynced: vi.fn(async () => true),
      catchUp: vi.fn(async () => true),
      requestUnreadCalibration: vi.fn(async () => {}),
      recordUnreadSnapshot: vi.fn(async () => {}),
    })

    afterEach(() => {
      registerSyncEngine(null)
    })

    it("recounts through the engine only when the refresh asks for it", async () => {
      const handle = engine()
      registerSyncEngine(handle)
      setSyncEngineActive(true)

      await unreadSyncService.refresh()
      expect(handle.ensureSynced).toHaveBeenCalledTimes(1)
      expect(handle.requestUnreadCalibration).not.toHaveBeenCalled()
      expect(getUnreadMock).not.toHaveBeenCalled()

      await unreadSyncService.refresh({ calibrate: true })
      expect(handle.requestUnreadCalibration).toHaveBeenCalledTimes(1)
      expect(getUnreadMock).not.toHaveBeenCalled()
    })

    it("tells the engine which sync id a snapshot reflects, also when it changes nothing", async () => {
      const handle = engine()
      registerSyncEngine(handle)
      setSyncEngineActive(true)
      getUnreadMock.mockResolvedValue({ code: 0, data: { feed1: 2 }, lastSyncId: 42 })

      await unreadSyncService.resetFromRemote()
      expect(handle.recordUnreadSnapshot).toHaveBeenCalledWith(42)

      getUnreadMock.mockResolvedValue({ code: 0, data: { feed1: 2 }, lastSyncId: 43 })
      await unreadSyncService.resetFromRemote()
      expect(handle.recordUnreadSnapshot).toHaveBeenLastCalledWith(43)
      expect(useUnreadStore.getState().data).toEqual({ feed1: 2 })
    })
  })
})
