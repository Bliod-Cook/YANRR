import { FeedViewType } from "@follow/constants"
import type { UnreadSchema } from "@follow/database/schemas/types"
import { EntryService } from "@follow/database/services/entry"
import { UnreadService } from "@follow/database/services/unread"
import type { DB } from "@follow/database/types"
import type {
  MarkAllAsReadRequest,
  MarkAllAsReadResponse,
  ReadOperationResponse,
} from "@follow-app/client-sdk"
import { isEqual } from "es-toolkit"

import { api } from "../../context"
import type { Hydratable } from "../../lib/base"
import { createTransaction, createZustandStore } from "../../lib/helper"
import { entryReadOverlayKey } from "../../sync/overlay-keys"
import {
  ensureSyncedThroughEngine,
  recordUnreadSnapshotThroughEngine,
  requestUnreadCalibration,
} from "../../sync/sync-status"
import { defineTransactionKind, transactionQueue } from "../../sync/transaction-queue"
import { getEntry } from "../entry/getter"
import { entryActions } from "../entry/store"
import { setFeedUnreadDirty } from "../feed/hooks"
import { getSubscribedFeedIdAndInboxHandlesByView } from "../subscription/getter"
import type {
  FeedIdOrInboxHandle,
  InsertedBeforeTimeRangeFilter,
  PublishAtTimeRangeFilter,
  UnreadState,
  UnreadStoreModel,
  UnreadUpdateOptions,
} from "./types"

const initialUnreadStore: UnreadState = {
  data: {},
}

export const useUnreadStore = createZustandStore<UnreadState>("unread")(() => initialUnreadStore)
const get = useUnreadStore.getState
const set = useUnreadStore.setState

type ReadEntryTarget = {
  entryId: string
  id: FeedIdOrInboxHandle
  isInbox: boolean
}

type TimeRangeFilter = PublishAtTimeRangeFilter | InsertedBeforeTimeRangeFilter

const countEntriesById = (entryIds: string[]): UnreadStoreModel => {
  const countById: UnreadStoreModel = {}

  for (const entryId of entryIds) {
    const entry = getEntry(entryId)
    const id = entry?.inboxHandle || entry?.feedId
    if (!id) continue

    countById[id] = (countById[id] || 0) + 1
  }

  return countById
}

const applyCountDelta = (
  counts: UnreadStoreModel,
  delta: UnreadStoreModel,
  direction: "increment" | "decrement",
) => {
  for (const [id, count] of Object.entries(delta)) {
    const current = counts[id] ?? 0
    counts[id] = direction === "increment" ? current + count : Math.max(0, current - count)
  }
}

const toUnreadRows = (counts: UnreadStoreModel): UnreadSchema[] =>
  Object.entries(counts).map(([id, count]) => ({ id, count }))

const mergeEntryIds = (payloads: { entryIds: string[] }[]) =>
  Array.from(new Set(payloads.flatMap((payload) => payload.entryIds)))

const mergeCountIds = (payloads: { unreadCountById: UnreadStoreModel }[]) =>
  Array.from(new Set(payloads.flatMap((payload) => Object.keys(payload.unreadCountById))))

// ---------------------------------------------------------------------------
// Transaction kinds
// ---------------------------------------------------------------------------
//
// A kind's effect on the counts lives in `rebaseUnread` only: applying and rolling back derive
// the displayed counts again, with the transaction in the queue or out of it.

interface MarkEntriesReadPayload {
  entryIds: string[]
  isInbox: boolean
  /** Unread entries per feed or inbox at the time the intent was recorded. */
  unreadCountById: UnreadStoreModel
}

interface MarkEntryUnreadPayload {
  entryId: string
  isInbox: boolean
  id: FeedIdOrInboxHandle
}

interface MarkAllReadPayload {
  /** Feed ids or inbox handles covered by the request. */
  ids: FeedIdOrInboxHandle[]
  /** Local entries that were unread when the intent was recorded. */
  entryIds: string[]
  args: MarkAllAsReadRequest
  /** Absent in transactions recorded before every request was bounded in time */
  time?: TimeRangeFilter
  /** Optimistic decrement per id */
  unreadCountById: UnreadStoreModel
}

export const markEntriesReadTransaction = defineTransactionKind<
  MarkEntriesReadPayload,
  ReadOperationResponse
>({
  kind: "reads.mark-entries-read",
  batchKey: (payload) => (payload.isInbox ? "inbox" : "feed"),
  apply(payload) {
    entryActions.markEntryReadStatusInSession({ entryIds: payload.entryIds, read: true })
    unreadActions.syncDisplayedCounts(Object.keys(payload.unreadCountById))
  },
  rollback(payload) {
    entryActions.markEntryReadStatusInSession({ entryIds: payload.entryIds, read: false })
    unreadActions.syncDisplayedCounts(Object.keys(payload.unreadCountById))
  },
  execute: (payloads) =>
    api().reads.markAsRead({
      entryIds: mergeEntryIds(payloads),
      isInbox: payloads[0]!.isInbox,
    }),
  syncIdOf: (result) => result.lastSyncId,
  async persist(payloads, _result, { awaitsSync }) {
    await EntryService.patchMany({
      entry: { read: true },
      entryIds: mergeEntryIds(payloads),
    })
    // With a change log the server reports how many rows really flipped; guessing here as
    // well would count entries twice that another device had already marked.
    if (!awaitsSync) {
      await unreadActions.commitLocalEffect(mergeCountIds(payloads), (counts) => {
        for (const payload of payloads) {
          applyCountDelta(counts, payload.unreadCountById, "decrement")
        }
      })
    }
  },
  overlays: (payload) =>
    payload.entryIds.map((entryId) => ({ key: entryReadOverlayKey(entryId), value: true })),
  rebaseUnread: (payload, counts) => {
    applyCountDelta(counts, payload.unreadCountById, "decrement")
  },
})

export const markEntryUnreadTransaction = defineTransactionKind<
  MarkEntryUnreadPayload,
  ReadOperationResponse
>({
  kind: "reads.mark-entry-unread",
  apply(payload) {
    entryActions.markEntryReadStatusInSession({ entryIds: [payload.entryId], read: false })
    unreadActions.syncDisplayedCounts([payload.id])
  },
  rollback(payload) {
    entryActions.markEntryReadStatusInSession({ entryIds: [payload.entryId], read: true })
    unreadActions.syncDisplayedCounts([payload.id])
  },
  execute(payloads) {
    const payload = payloads[0]!
    return api().reads.markAsUnread({ entryId: payload.entryId, isInbox: payload.isInbox })
  },
  syncIdOf: (result) => result.lastSyncId,
  async persist(payloads, _result, { awaitsSync }) {
    const payload = payloads[0]!
    await EntryService.patchMany({
      entry: { read: false },
      entryIds: [payload.entryId],
    })
    if (!awaitsSync) {
      await unreadActions.commitLocalEffect([payload.id], (counts) => {
        applyCountDelta(counts, { [payload.id]: 1 }, "increment")
      })
    }
  },
  overlays: (payload) => [{ key: entryReadOverlayKey(payload.entryId), value: false }],
  rebaseUnread: (payload, counts) => {
    applyCountDelta(counts, { [payload.id]: 1 }, "increment")
  },
})

export const markAllReadTransaction = defineTransactionKind<
  MarkAllReadPayload,
  MarkAllAsReadResponse
>({
  kind: "reads.mark-all-read",
  apply(payload) {
    entryActions.markEntryReadStatusInSession({ ids: payload.ids, read: true, time: payload.time })
    unreadActions.syncDisplayedCounts(payload.ids)
  },
  rollback(payload) {
    entryActions.markEntryReadStatusInSession({ entryIds: payload.entryIds, read: false })
    unreadActions.syncDisplayedCounts(payload.ids)
  },
  execute: (payloads) => api().reads.markAllAsRead(payloads[0]!.args),
  syncIdOf: (result) => result.lastSyncId,
  async persist(payloads, { data }, { awaitsSync }) {
    const { ids, time } = payloads[0]!
    // The server reports what it flipped per feed, which leaves out what arrived after the time
    // bound. With a change log, the log reports the same, and taking it off here as well would
    // count it twice.
    if (!awaitsSync) {
      await unreadActions.commitLocalEffect(Object.keys(data.read), (counts) => {
        applyCountDelta(counts, data.read, "decrement")
      })
    }
    await EntryService.patchMany({ feedIds: ids, entry: { read: true }, time })
  },
  overlays: (payload) =>
    payload.entryIds.map((entryId) => ({ key: entryReadOverlayKey(entryId), value: true })),
  rebaseUnread: (payload, counts) => {
    applyCountDelta(counts, payload.unreadCountById, "decrement")
  },
})

// ---------------------------------------------------------------------------
// Sync service
// ---------------------------------------------------------------------------

class UnreadSyncService {
  /**
   * Bring the counters up to date after a user gesture. The delta feed does it when the sync
   * engine runs; the recount is the fallback. A refresh the user asked for also recounts
   * through the engine, at most once a minute, so counters that drifted from the list on
   * screen do not wait for the hourly calibration.
   */
  async refresh({ calibrate = false }: { calibrate?: boolean } = {}) {
    if (await ensureSyncedThroughEngine()) {
      if (calibrate) await requestUnreadCalibration()
      return
    }
    await this.resetFromRemote()
  }

  /**
   * Replace the confirmed counters with the server's. The answer names the sync id the counts
   * reflect, so the change log is not applied on top of what the snapshot already contains.
   */
  async resetFromRemote() {
    const res = await api().reads.get({})
    // This server names it with every count
    const snapshotSyncId = res.lastSyncId!
    // Marks the server numbered up to the snapshot are counted by it, so they are not taken
    // off it again, as when a replayed mark was acknowledged while the first sync loaded.
    const countsAcknowledged = transactionQueue.markUnreadSnapshot(snapshotSyncId)

    if (!unreadActions.isConfirmedEqual(res.data)) {
      await unreadActions.upsertMany(res.data, { reset: true })
    } else if (countsAcknowledged) {
      unreadActions.syncDisplayedCounts()
    }
    await recordUnreadSnapshotThroughEngine(snapshotSyncId)
    return res.data
  }

  private async markAllAsRead({
    ids,
    time,
    args,
  }: {
    ids: FeedIdOrInboxHandle[]
    time?: TimeRangeFilter
    args: MarkAllAsReadRequest
  }) {
    if (!ids || ids.length === 0) return

    // The request can wait in the queue for long, offline. What arrives meanwhile was never
    // shown, so the server leaves out what it took in after the gesture.
    const range = time ?? { insertedBefore: Date.now() }
    const entryIds = entryActions.collectEntryIdsToMarkInSession({ ids, read: true, time: range })
    // A range of the caller's covers the entries it holds; without one, every unread counted now
    const unreadCountById = time
      ? countEntriesById(entryIds)
      : Object.fromEntries(ids.map((id) => [id, get().data[id] ?? 0]))

    ids.forEach((id) => {
      if (id) {
        setFeedUnreadDirty(id)
      }
    })

    await transactionQueue.enqueue(markAllReadTransaction, {
      ids,
      entryIds,
      args: { ...args, ...range },
      time: range,
      unreadCountById,
    })
  }

  async markBatchAsRead({
    view,
    filter,
    time,
  }: {
    view: FeedViewType | undefined
    filter?: {
      feedId?: string
      feedIdList?: string[]
      inboxId?: string
    } | null
    time?: TimeRangeFilter
  }) {
    const args: MarkAllAsReadRequest = {
      view: view === FeedViewType.All ? undefined : view,
      ...filter,
      ...time,
    }
    if (view === FeedViewType.All) {
      delete args.view
    }

    if (filter?.feedIdList) {
      await this.markAllAsRead({ ids: filter.feedIdList, time, args })
    } else if (filter?.feedId) {
      await this.markAllAsRead({ ids: [filter.feedId], time, args })
    } else if (filter?.inboxId) {
      await this.markAllAsRead({ ids: [filter.inboxId], time, args })
    } else {
      const feedIdAndInboxHandles = getSubscribedFeedIdAndInboxHandlesByView({
        view,
        excludeHidden: true,
      })
      await this.markAllAsRead({ ids: feedIdAndInboxHandles, time, args })
    }
  }

  async markViewAsRead(view: FeedViewType) {
    await this.markBatchAsRead({
      view: view === FeedViewType.All ? undefined : view,
    })
  }

  async markFeedAsRead(feedId: string | string[], time?: PublishAtTimeRangeFilter) {
    const feedIds = Array.isArray(feedId) ? feedId : [feedId]

    await this.markBatchAsRead({
      view: undefined,
      filter: {
        feedIdList: feedIds,
      },
      time,
    })
  }

  private getReadEntryTargets(entryIds: string[]): ReadEntryTarget[] {
    const seenEntryIds = new Set<string>()
    const targets: ReadEntryTarget[] = []

    for (const entryId of entryIds) {
      if (seenEntryIds.has(entryId)) continue
      seenEntryIds.add(entryId)

      const entry = getEntry(entryId)
      if (!entry || entry.read || (!entry.feedId && !entry.inboxHandle)) continue

      targets.push({
        entryId,
        id: entry.inboxHandle || entry.feedId || "",
        isInbox: !!entry.inboxHandle,
      })
    }

    return targets
  }

  /**
   * Record the intent to mark entries as read. The optimistic effect is applied at once;
   * adjacent marks are sent to the server in a single request by the transaction queue.
   */
  async markEntriesAsRead(entryIds: string[]) {
    const targets = this.getReadEntryTargets(entryIds)
    if (targets.length === 0) return

    const groups = [
      { isInbox: false, targets: targets.filter((target) => !target.isInbox) },
      { isInbox: true, targets: targets.filter((target) => target.isInbox) },
    ]

    for (const group of groups) {
      if (group.targets.length === 0) continue

      const unreadCountById = group.targets.reduce((acc, target) => {
        acc[target.id] = (acc[target.id] || 0) + 1
        return acc
      }, {} as UnreadStoreModel)

      Object.keys(unreadCountById).forEach((id) => {
        if (id) {
          setFeedUnreadDirty(id)
        }
      })

      await transactionQueue.enqueue(markEntriesReadTransaction, {
        entryIds: group.targets.map((target) => target.entryId),
        isInbox: group.isInbox,
        unreadCountById,
      })
    }
  }

  /**
   * @deprecated `markEntriesAsRead` already batches through the transaction queue.
   */
  queueEntriesAsRead(entryIds: string[]) {
    return this.markEntriesAsRead(entryIds)
  }

  private async markEntryReadStatus({ entryId, read }: { entryId: string; read: boolean }) {
    if (read) {
      return this.markEntriesAsRead([entryId])
    }

    const entry = getEntry(entryId)
    if (!entry || entry.read === read || (!entry.feedId && !entry.inboxHandle)) return

    const id: FeedIdOrInboxHandle = entry.inboxHandle || entry.feedId || ""
    const isInbox = !!entry.inboxHandle

    if (entry.feedId) {
      setFeedUnreadDirty(entry.feedId)
    }

    await transactionQueue.enqueue(markEntryUnreadTransaction, { entryId, isInbox, id })
  }

  async markEntryAsRead(entryId: string) {
    return this.markEntryReadStatus({ entryId, read: true })
  }

  async markEntryAsUnread(entryId: string) {
    return this.markEntryReadStatus({ entryId, read: false })
  }
}

// ---------------------------------------------------------------------------
// Store actions
// ---------------------------------------------------------------------------

/**
 * Unread counters are derived on the server, so the client keeps two layers, like Linear
 * keeps a confirmed model under its local transactions:
 *
 * - the confirmed counts, moved by snapshots, by the change log and by transactions the
 *   server acknowledged without a change log, and the only thing written to the database;
 * - `data`, what the UI shows: the confirmed counts with every unsettled local transaction
 *   re-applied on top, always derived through `syncDisplayedCounts`.
 *
 * A transaction therefore never has to predict its real effect: when the change log reports
 * what the server flipped, the prediction is simply dropped.
 */
class UnreadActions implements Hydratable {
  private confirmed: UnreadStoreModel = {}

  async hydrate() {
    const unreads = await UnreadService.getUnreadAll()
    this.upsertManyInSession(unreads, { reset: true })
  }

  /** Set confirmed counts in memory and derive the displayed ones from them */
  upsertManyInSession(unreads: UnreadSchema[], options?: UnreadUpdateOptions) {
    if (options?.reset) {
      this.confirmed = {}
    }
    for (const unread of unreads) {
      this.confirmed[unread.id] = unread.count
    }
    this.syncDisplayedCounts(options?.reset ? undefined : unreads.map((unread) => unread.id))
  }

  /**
   * Derive the displayed counts from the confirmed ones and the unsettled local transactions.
   * Without `ids` everything is derived again, which also drops ids the server forgot.
   */
  syncDisplayedCounts(ids?: FeedIdOrInboxHandle[]) {
    const current = useUnreadStore.getState().data

    if (!ids) {
      const nextData = { ...this.confirmed }
      transactionQueue.rebaseUnreadCounts(nextData)
      if (!isEqual(nextData, current)) {
        set({ data: nextData })
      }
      return
    }

    if (ids.length === 0) return
    const scratch: UnreadStoreModel = {}
    for (const id of ids) {
      scratch[id] = this.confirmed[id] ?? 0
    }
    transactionQueue.rebaseUnreadCounts(scratch, new Set(ids))

    if (ids.every((id) => current[id] === scratch[id])) return
    const nextData = { ...current }
    for (const id of ids) {
      nextData[id] = scratch[id] ?? 0
    }
    set({ data: nextData })
  }

  isConfirmedEqual(counts: UnreadStoreModel) {
    return isEqual(counts, this.confirmed)
  }

  /**
   * Move `changes`, counts about to be confirmed, by what the change log reported: rows that
   * flipped on any device, or new unread entries. Each delta stops at zero, as a count does.
   */
  moveCounts(changes: UnreadStoreModel, deltas: UnreadStoreModel) {
    for (const [id, delta] of Object.entries(deltas)) {
      if (!id || !delta) continue
      changes[id] = Math.max(0, (changes[id] ?? this.confirmed[id] ?? 0) + delta)
    }
  }

  /** Write counts in `tx`, the transaction that also stores the sync cursor covering them */
  storeConfirmed(changes: UnreadStoreModel, tx: DB) {
    return UnreadService.upsertMany(toUnreadRows(changes), { tx })
  }

  /**
   * Counts stored with `storeConfirmed` become the confirmed ones. Deriving the displayed ones
   * is left to the caller, which first settles the transactions the counts include.
   */
  confirm(changes: UnreadStoreModel) {
    Object.assign(this.confirmed, changes)
  }

  /**
   * Make the effect of an acknowledged transaction part of the confirmed counts. Only used
   * when no change log will report the real effect, so the prediction is all there is.
   */
  async commitLocalEffect(ids: FeedIdOrInboxHandle[], mutate: (counts: UnreadStoreModel) => void) {
    if (ids.length === 0) return
    const scratch: UnreadStoreModel = {}
    for (const id of ids) {
      scratch[id] = this.confirmed[id] ?? 0
    }
    mutate(scratch)
    for (const id of ids) {
      this.confirmed[id] = Math.max(0, scratch[id] ?? 0)
    }
    this.syncDisplayedCounts(ids)
    await UnreadService.upsertMany(ids.map((id) => ({ id, count: this.confirmed[id] ?? 0 })))
  }

  async upsertMany(unreads: UnreadSchema[] | UnreadStoreModel, options?: UnreadUpdateOptions) {
    const normalizedUnreads = Array.isArray(unreads) ? unreads : toUnreadRows(unreads)

    const tx = createTransaction()
    tx.store(() => this.upsertManyInSession(normalizedUnreads, options))
    // The database keeps the confirmed counts; pending transactions are replayed on top after a restart.
    tx.persist(() => UnreadService.upsertMany(normalizedUnreads, { reset: options?.reset }))
    await tx.run()
  }

  async updateById(id: FeedIdOrInboxHandle | undefined | null, count: number) {
    if (!id) return
    if ((this.confirmed[id] ?? 0) === count && (useUnreadStore.getState().data[id] ?? 0) === count)
      return
    await this.upsertMany([{ id, count }])
  }
}

export const unreadActions = new UnreadActions()
export const unreadSyncService = new UnreadSyncService()

// A settled transaction no longer overrides the confirmed counts. When the change log
// reported fewer flips than predicted, this is the moment the prediction is corrected.
transactionQueue.onSettled(({ records }) => {
  if (records.some((record) => record.kind.startsWith("reads."))) {
    unreadActions.syncDisplayedCounts()
  }
})
