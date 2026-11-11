import { FeedViewType } from "@follow/constants"
import { withTransaction } from "@follow/database/db"
import { EntryService } from "@follow/database/services/entry"
import { InboxService } from "@follow/database/services/inbox"
import { SubscriptionService } from "@follow/database/services/subscription"
import { SyncMetaService } from "@follow/database/services/sync-meta"

import { syncApi } from "../context"
import { collectionActions } from "../modules/collection/store"
import { invalidateEntriesQuery, refreshEntriesHead } from "../modules/entry/hooks"
import { entryActions } from "../modules/entry/store"
import { setFeedUnreadDirtyMany } from "../modules/feed/hooks"
import { feedActions } from "../modules/feed/store"
import { inboxActions, useInboxStore } from "../modules/inbox/store"
import { getSubscriptionById } from "../modules/subscription/getter"
import {
  getConfirmedSubscriptionChange,
  subscriptionActions,
  subscriptionSyncService,
} from "../modules/subscription/store"
import type { SubscriptionModel } from "../modules/subscription/types"
import {
  getInboxStoreId,
  getSubscriptionDBId,
  getSubscriptionStoreId,
} from "../modules/subscription/utils"
import { unreadActions, unreadSyncService } from "../modules/unread/store"
import type { UnreadStoreModel } from "../modules/unread/types"
import { whoami } from "../modules/user/getters"
import { useUserStore } from "../modules/user/store"
import { apiMorph } from "../morph/api"
import { getSyncModelHandler, getSyncModelHandlers } from "./model-registry"
import { entryReadOverlayKey } from "./overlay-keys"
import { registerSyncEngine, setSyncEngineActive, setSyncEngineBootstrapping } from "./sync-status"
import { isNavigatorOnline, transactionQueue } from "./transaction-queue"
import type {
  CollectionActionData,
  InboxEntryActionData,
  SyncAction,
  TimelineNewEntriesActionData,
  TimelineReadActionData,
} from "./types"

/**
 * Incremental synchronization of user-owned models, modelled on Linear's sync engine.
 *
 * The client keeps `lastSyncId`, the highest change-log id it applied. A bootstrap takes
 * the current id from the server and then loads full snapshots; every later pull asks for
 * the actions recorded after the cursor and applies them to the stores. Pending local
 * transactions keep precedence through the transaction queue's overlays.
 *
 * Once a cursor exists the snapshots are not needed for freshness any more: the local
 * database plus the delta feed is the state. Snapshots are only taken again as a rare
 * calibration, for the things the change log cannot express: unread entries ageing out of
 * the retention window, and feed metadata, which is not owned by the user.
 */

const LAST_SYNC_ID_KEY = "lastSyncId"
const UNREAD_CALIBRATED_AT_KEY = "unreadCalibratedAt"
/** The sync id the last unread snapshot reflects; counters logged up to it are not applied again. */
const UNREAD_SNAPSHOT_SYNC_ID_KEY = "unreadSnapshotSyncId"
const SUBSCRIPTIONS_CALIBRATED_AT_KEY = "subscriptionsCalibratedAt"
/** Set once a registered model was loaded in full, so later launches rely on the change log. */
const modelBootstrappedKey = (model: string) => `bootstrapped:${model}`
const PULL_INTERVAL_MS = 60_000
const UNREAD_CALIBRATION_INTERVAL_MS = 60 * 60_000
const SUBSCRIPTIONS_CALIBRATION_INTERVAL_MS = 24 * 60 * 60_000
/** A recount asked for by the UI is not repeated more often than this. */
const REQUESTED_CALIBRATION_MIN_INTERVAL_MS = 60_000
/** `ensureSynced` callers arriving within this window share the previous pull. */
const FRESH_PULL_WINDOW_MS = 5000
/** The queue acknowledges one batch at a time; one pull after the last of them covers them all. */
const ACK_PULL_DELAY_MS = 1500
const MAX_PAGES_PER_PULL = 20
/** An action that failed this many pulls in a row is given up on: the engine loads everything again. */
const MAX_ACTION_FAILURES = 3
// Below SQLite's oldest default limit of 999 bound variables
const READS_PER_WRITE = 500

export type SyncPullReason = "launch" | "resume" | "interval" | "ack" | "manual"

type SubscriptionSyncPayload = Parameters<typeof apiMorph.toSubscription>[0][number]

interface PullSummary {
  /** An action changed unread counters in a way only a recount can resolve. */
  refreshUnread: boolean
  /** Views whose timelines changed structurally: a subscription moved. */
  invalidateViews: Set<FeedViewType>
  /** Views that received new entries; only the head of their lists needs fetching. */
  newEntryViews: Set<FeedViewType>
  /** When the newest of those entries was logged, to skip lists fetched after it. */
  newestEntryAt: number
}

const createPullSummary = (): PullSummary => ({
  refreshUnread: false,
  invalidateViews: new Set(),
  newEntryViews: new Set(),
  newestEntryAt: 0,
})

/** What applying one page of the change log did so far */
interface PageProgress {
  /** The last action whose effects were all applied: the cursor may move up to it. */
  appliedThrough: number
  /** Counters the applied actions moved, confirmed once they are stored with the cursor. */
  unread: UnreadStoreModel
  /** Feeds and inboxes whose unread entries need fetching again */
  dirtyFeedIds: Set<string>
  /**
   * The read state each entry ends with after the run of read actions collected last, applied
   * together: a device catching up on another's reading gets hundreds of them.
   */
  reads: Map<string, boolean>
  /** The counter moves of those actions, in their order, since each stops at zero */
  readDeltas: UnreadStoreModel[]
  /** The ids of the first and the last action of that run, `null` without one */
  readsFrom: number | null
  readsThrough: number
}

const createPageProgress = (cursor: number): PageProgress => ({
  appliedThrough: cursor,
  unread: {},
  dirtyFeedIds: new Set(),
  reads: new Map(),
  readDeltas: [],
  readsFrom: null,
  readsThrough: cursor,
})

const isReadAction = (action: SyncAction) => action.model === "timeline" && action.action === "U"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const addView = (views: Set<FeedViewType>, view: FeedViewType | undefined) => {
  if (typeof view !== "number") return
  views.add(view)
  views.add(FeedViewType.All)
}

/**
 * The row was logged before a follow or unfollow of the same feed that the server already
 * confirmed to this device. The delta lags behind such a response, so applying the row would
 * bring back the state before it, such as an unfollowed feed.
 */
const isOlderThanConfirmedChange = (action: SyncAction) => {
  if (!action.modelId) return false
  const change = getConfirmedSubscriptionChange(action.modelId)
  if (!change) return false
  return change.syncId === undefined || action.id < change.syncId
}

class SyncEngine {
  private lastSyncId: number | null = null
  private loaded = false
  private unreadCalibratedAt = 0
  private unreadSnapshotSyncId = 0
  private subscriptionsCalibratedAt = 0
  private lastPullFinishedAt = 0
  /** The action the last pull stopped at, and how many pulls in a row it failed */
  private failedActionId: number | null = null
  private actionFailures = 0
  /** Models whose actions were skipped this session because nobody handled them yet. */
  private unhandledModels = new Set<string>()
  /**
   * Views that received new entries while the user was reading. Their lists are left alone
   * until the next return to the app, which is when they are brought up to date.
   */
  private pendingNewEntryViews = new Set<FeedViewType>()
  private pendingNewestEntryAt = 0
  private pulling: Promise<void> | null = null
  /** Pulls and recounts asked for by the UI, one after the other */
  private exclusiveTasks: Promise<unknown> = Promise.resolve()
  private pullTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private listenersAttached = false

  getLastSyncId() {
    return this.lastSyncId
  }

  /** Load the cursor, attach the triggers and run the first pull. Call once after hydration. */
  async start() {
    await this.loadCursor()
    this.attachListeners()
    this.schedulePull("launch")
  }

  private async loadCursor() {
    if (this.loaded) return
    try {
      const [stored, unreadCalibratedAt, unreadSnapshotSyncId, subscriptionsCalibratedAt] =
        await Promise.all([
          SyncMetaService.get(LAST_SYNC_ID_KEY),
          SyncMetaService.get(UNREAD_CALIBRATED_AT_KEY),
          SyncMetaService.get(UNREAD_SNAPSHOT_SYNC_ID_KEY),
          SyncMetaService.get(SUBSCRIPTIONS_CALIBRATED_AT_KEY),
        ])
      const parsed = stored === null ? Number.NaN : Number(stored)
      this.lastSyncId = Number.isFinite(parsed) ? parsed : null
      this.unreadCalibratedAt = Number(unreadCalibratedAt) || 0
      this.unreadSnapshotSyncId = Number(unreadSnapshotSyncId) || 0
      this.subscriptionsCalibratedAt = Number(subscriptionsCalibratedAt) || 0
      setSyncEngineActive(this.lastSyncId !== null)
    } catch (error) {
      console.error("[sync-engine] failed to load the sync cursor", error)
    }
    this.loaded = true
  }

  /** The network or the app came back: pull as soon as possible. */
  resume() {
    // Coming back fires more than one event (focus, visibility); one pull covers them. A pull
    // for another reason leaves the new entries it found to the lists, so they are owed now.
    if (this.pulling) {
      void this.pulling.then(() => this.flushPendingHead())
      return
    }
    if (Date.now() - this.lastPullFinishedAt < FRESH_PULL_WINDOW_MS) {
      void this.flushPendingHead()
      return
    }
    this.schedulePull("resume")
  }

  schedulePull(reason: SyncPullReason, delayMs = 0) {
    if (this.pullTimer) {
      clearTimeout(this.pullTimer)
    }
    this.pullTimer = setTimeout(() => {
      this.pullTimer = null
      void this.pull(reason)
    }, delayMs)
  }

  pull(reason: SyncPullReason = "manual"): Promise<void> {
    if (this.pulling) return this.pulling
    this.pulling = this.exclusively(() => this.runPull(reason))
      .catch((error) => {
        console.error("[sync-engine] pull failed", error)
      })
      .finally(() => {
        this.pulling = null
        this.lastPullFinishedAt = Date.now()
      })
    return this.pulling
  }

  /**
   * Bring the stores up to date through the engine and say whether that was possible.
   *
   * `true` means the local stores are the state: either the delta feed was applied on top of
   * the local snapshot, or a bootstrap just loaded everything. Callers must not fetch their
   * own snapshot then. `false` means the engine cannot help, as when signed out or before the
   * first bootstrap went through, and the caller has to fall back to its full request.
   *
   * A pull that fails with a cursor in place still answers `true`: the local snapshot is the
   * best state there is, and the next trigger retries.
   */
  async ensureSynced(): Promise<boolean> {
    if (!whoami()) return false
    if (this.pulling || Date.now() - this.lastPullFinishedAt > FRESH_PULL_WINDOW_MS) {
      await this.pull("manual")
    }
    return this.lastSyncId !== null
  }

  /**
   * Pick up a change the server made outside the transaction queue, for instance an import. A
   * pull already running may have read its last page before the change, so another follows it.
   */
  async catchUp(): Promise<boolean> {
    if (this.lastSyncId === null) return false
    await this.pulling
    await this.pull("manual")
    return this.lastSyncId !== null
  }

  /**
   * The UI noticed counters that cannot be right. Recount, but not more often than once a
   * minute: the usual cause is a list that is simply ahead of the next pull. Never while a pull
   * applies the change log, whose counts an older snapshot would overwrite.
   */
  requestUnreadCalibration() {
    return this.exclusively(async () => {
      if (Date.now() - this.unreadCalibratedAt < REQUESTED_CALIBRATION_MIN_INTERVAL_MS) return
      await this.calibrateUnread()
    })
  }

  /** Runs `task` once the pulls and recounts started before it are done */
  private exclusively<T>(task: () => Promise<T>): Promise<T> {
    const result = this.exclusiveTasks.then(task)
    this.exclusiveTasks = result.catch(() => {})
    return result
  }

  /** Take the server's current id, then load full snapshots. Later pulls are incremental. */
  private async bootstrap() {
    const { lastSyncId } = (await syncApi().state()).data

    // The new cursor is below the old one when the server's change log started over, as after
    // a restored backup. What was applied or counted up to the old one says nothing about it.
    this.unreadSnapshotSyncId = 0
    await SyncMetaService.delete(UNREAD_SNAPSHOT_SYNC_ID_KEY)
    transactionQueue.resetSyncPosition()
    this.failedActionId = null

    // A change acknowledged from now on is after the cursor, so the first pull delivers its
    // real effect. Committing its own prediction as well would count it twice, as when an
    // outbox replay on a fresh profile is acknowledged while the snapshots load.
    setSyncEngineBootstrapping(true)
    try {
      await subscriptionSyncService.fetch()
      await this.markCalibrated(SUBSCRIPTIONS_CALIBRATED_AT_KEY)
      // The snapshot reflects at least the id read above, and names the one it does.
      await unreadSyncService.resetFromRemote()
      await this.markCalibrated(UNREAD_CALIBRATED_AT_KEY)
      await this.bootstrapRegisteredModels({ force: true })
      await this.storeCursor(lastSyncId)
    } finally {
      setSyncEngineBootstrapping(false)
    }
  }

  /**
   * Load registered models that were never loaded in full on this account. With `force`
   * every model is loaded again, because the engine lost its place in the change log.
   */
  private async bootstrapRegisteredModels({ force = false }: { force?: boolean } = {}) {
    await Promise.all(
      Array.from(getSyncModelHandlers(), async ([model, handler]) => {
        if (!handler.bootstrap) return
        const key = modelBootstrappedKey(model)
        try {
          if (!force && (await SyncMetaService.get(key)) !== null) return
          await handler.bootstrap()
          await SyncMetaService.set(key, "1")
          this.unhandledModels.delete(model)
        } catch (error) {
          // The flag stays unset, so the next pull tries again.
          console.error(`[sync-engine] failed to bootstrap ${model}`, error)
        }
      }),
    )
  }

  /**
   * Recount through `/reads`. The snapshot is paired with the sync id it reflects, so the
   * counters of actions logged before it are not added on top when the log delivers them
   * later, as when new-entry hints logged seconds earlier arrive with the next pull.
   */
  private async calibrateUnread() {
    // Claim the slot first so concurrent triggers do not recount twice.
    await this.markCalibrated(UNREAD_CALIBRATED_AT_KEY)
    await unreadSyncService.resetFromRemote().catch((error) => {
      console.error("[sync-engine] failed to recount unread entries", error)
    })
  }

  /** Remember how far the log was reflected by the last unread snapshot. */
  async recordUnreadSnapshot(lastSyncId: number) {
    if (!Number.isFinite(lastSyncId) || lastSyncId <= this.unreadSnapshotSyncId) return
    this.unreadSnapshotSyncId = lastSyncId
    await SyncMetaService.set(UNREAD_SNAPSHOT_SYNC_ID_KEY, String(lastSyncId)).catch((error) => {
      console.error("[sync-engine] failed to persist the unread snapshot id", error)
    })
  }

  private async calibrateSubscriptions() {
    await this.markCalibrated(SUBSCRIPTIONS_CALIBRATED_AT_KEY)
    await subscriptionSyncService.fetch().catch((error) => {
      console.error("[sync-engine] failed to refresh subscriptions", error)
    })
  }

  private async markCalibrated(
    key: typeof UNREAD_CALIBRATED_AT_KEY | typeof SUBSCRIPTIONS_CALIBRATED_AT_KEY,
  ) {
    const now = Date.now()
    if (key === UNREAD_CALIBRATED_AT_KEY) {
      this.unreadCalibratedAt = now
    } else {
      this.subscriptionsCalibratedAt = now
    }
    await SyncMetaService.set(key, String(now)).catch((error) => {
      console.error("[sync-engine] failed to persist the calibration time", error)
    })
  }

  /** Forget everything in memory, as when the app quits. */
  clearInSession() {
    if (this.pullTimer) {
      clearTimeout(this.pullTimer)
      this.pullTimer = null
    }
    this.lastSyncId = null
    this.loaded = false
    this.unreadCalibratedAt = 0
    this.unreadSnapshotSyncId = 0
    this.subscriptionsCalibratedAt = 0
    this.lastPullFinishedAt = 0
    this.failedActionId = null
    this.actionFailures = 0
    this.unhandledModels.clear()
    this.pendingNewEntryViews.clear()
    this.pendingNewestEntryAt = 0
    setSyncEngineActive(false)
    setSyncEngineBootstrapping(false)
  }

  private async runPull(reason: SyncPullReason) {
    if (!whoami() || !isNavigatorOnline()) return
    await this.loadCursor()

    if (this.lastSyncId === null) {
      await this.bootstrap()
      return
    }

    const summary = createPullSummary()
    let cursor = this.lastSyncId

    for (let page = 0; page < MAX_PAGES_PER_PULL; page++) {
      const { data } = await syncApi().delta({ lastSyncId: cursor })
      if (data.reset) {
        await this.bootstrap()
        return
      }

      const progress = createPageProgress(cursor)
      const failedAt = await this.applyActions(data.actions, summary, progress)
      const through = failedAt === undefined ? data.lastSyncId : progress.appliedThrough
      if (through > cursor) {
        await this.storeCursor(through, progress.unread)
        cursor = through
        if (progress.dirtyFeedIds.size > 0) setFeedUnreadDirtyMany(progress.dirtyFeedIds)
      }

      if (failedAt !== undefined) {
        // The next pull starts with it again. One that keeps failing would hold the log up for
        // good, so the engine gives up on it and loads everything again.
        if (this.countFailure(failedAt)) {
          await this.bootstrap()
          return
        }
        break
      }
      this.failedActionId = null
      if (!data.hasMore) break
    }

    // After the delta, so a snapshot taken now is never overwritten by an older action.
    await this.bootstrapRegisteredModels()
    await this.finishPull(summary, reason)
  }

  /** Counts a failure of the action; `true` once it failed too often in a row */
  private countFailure(actionId: number) {
    if (this.failedActionId === actionId) {
      this.actionFailures += 1
    } else {
      this.failedActionId = actionId
      this.actionFailures = 1
    }
    return this.actionFailures >= MAX_ACTION_FAILURES
  }

  private async finishPull(summary: PullSummary, reason: SyncPullReason) {
    const now = Date.now()
    if (summary.refreshUnread || now - this.unreadCalibratedAt > UNREAD_CALIBRATION_INTERVAL_MS) {
      await this.calibrateUnread()
    }
    if (now - this.subscriptionsCalibratedAt > SUBSCRIPTIONS_CALIBRATION_INTERVAL_MS) {
      await this.calibrateSubscriptions()
    }

    // Lists whose subscriptions changed fetch their first page when they are entered next;
    // fetching every loaded page now would also jump them to the top.
    if (summary.invalidateViews.size > 0) {
      void invalidateEntriesQuery({ views: Array.from(summary.invalidateViews), refetch: false })
    }

    // New entries never rearrange what is already loaded, so only the edge of the lists on
    // screen is fetched. While the user is reading, the lists are left alone and the views
    // are remembered for the next return to the app.
    for (const view of summary.newEntryViews) {
      this.pendingNewEntryViews.add(view)
    }
    this.pendingNewestEntryAt = Math.max(this.pendingNewestEntryAt, summary.newestEntryAt)
    if (reason === "interval" || reason === "ack") return

    await this.flushPendingHead()
  }

  /** Fetches the new entries owed to the lists on screen, keeping them owed when that fails */
  private async flushPendingHead() {
    const views = Array.from(this.pendingNewEntryViews)
    const since = this.pendingNewestEntryAt
    this.pendingNewEntryViews.clear()
    this.pendingNewestEntryAt = 0
    if (views.length === 0) return

    await refreshEntriesHead({ views, since }).catch((error) => {
      console.error("[sync-engine] failed to fetch new entries", error)
      for (const view of views) this.pendingNewEntryViews.add(view)
      this.pendingNewestEntryAt = Math.max(this.pendingNewestEntryAt, since)
    })
  }

  /**
   * Store the cursor together with the counters the actions up to it moved, in one
   * transaction: a restart between the two would apply those actions again and count them
   * twice. Then settle the transactions the change log caught up with, and only after that
   * derive the displayed counts, which would otherwise take a reported flip off twice.
   */
  private async storeCursor(cursor: number, unread: UnreadStoreModel = {}) {
    await withTransaction(async (tx) => {
      await unreadActions.storeConfirmed(unread, tx)
      await SyncMetaService.set(LAST_SYNC_ID_KEY, String(cursor), tx)
    })
    unreadActions.confirm(unread)
    this.lastSyncId = cursor
    setSyncEngineActive(true)
    // Everything up to this id is reflected in what the server returns from now on.
    transactionQueue.markSynced(cursor)
    unreadActions.syncDisplayedCounts(Object.keys(unread))
  }

  /**
   * Apply a page of actions in their order and return the id of the one that failed, if one
   * did. Nothing after it is applied: the cursor stops before it, and the next pull starts
   * with it again. Applying an action again is safe, except for the counters it moves, which
   * are only confirmed with the cursor.
   */
  private async applyActions(
    actions: SyncAction[],
    summary: PullSummary,
    page: PageProgress,
  ): Promise<number | undefined> {
    for (const action of actions) {
      if (isReadAction(action)) {
        try {
          this.collectReadAction(action, page)
        } catch (error) {
          console.error(`[sync-engine] failed to apply timeline/U ${action.id}`, error)
          return action.id
        }
        continue
      }

      const failedRead = await this.flushReads(page)
      if (failedRead !== undefined) return failedRead
      try {
        await this.applyAction(action, summary, page)
        page.appliedThrough = action.id
      } catch (error) {
        console.error(
          `[sync-engine] failed to apply ${action.model}/${action.action} ${action.id}`,
          error,
        )
        return action.id
      }
    }
    return this.flushReads(page)
  }

  /** Adds a read action to those applied together by `flushReads`. */
  private collectReadAction(action: SyncAction, page: PageProgress) {
    page.readsFrom ??= action.id
    page.readsThrough = action.id
    if (!isRecord(action.data) || !Array.isArray(action.data.entryIds)) return
    const data = action.data as unknown as TimelineReadActionData
    // A pending local transaction on the same entry wins over the remote change.
    const overlays = transactionQueue.getOverlays()
    for (const entryId of data.entryIds) {
      const override = overlays.get(entryReadOverlayKey(entryId))
      if (typeof override !== "boolean" || override === data.read) {
        // Map keeps the first position, but the last state
        page.reads.set(entryId, data.read)
      }
    }

    // The last snapshot already counted everything logged up to its id.
    if (action.id <= this.unreadSnapshotSyncId) return

    // The counters follow the server even when a local transaction keeps an entry's read
    // state: that transaction is rebased on top of the confirmed counts.
    const sign = data.read ? -1 : 1
    page.readDeltas.push(
      Object.fromEntries(Object.entries(data.feeds).map(([id, count]) => [id, sign * count])),
    )
  }

  /**
   * One store update and one write per read state for the collected read actions. When that
   * fails, returns the id of the first of them, where the page stops.
   */
  private async flushReads(page: PageProgress): Promise<number | undefined> {
    if (page.readsFrom === null) return
    const { reads } = page

    try {
      if (reads.size > 0) {
        entryActions.setEntriesReadInSession(reads)
        for (const read of [true, false]) {
          const entryIds = Array.from(reads.keys()).filter((entryId) => reads.get(entryId) === read)
          for (let i = 0; i < entryIds.length; i += READS_PER_WRITE) {
            await EntryService.patchMany({
              entry: { read },
              entryIds: entryIds.slice(i, i + READS_PER_WRITE),
            })
          }
        }
      }
    } catch (error) {
      console.error("[sync-engine] failed to apply read states", error)
      return page.readsFrom
    }

    for (const deltas of page.readDeltas) {
      unreadActions.moveCounts(page.unread, deltas)
    }
    page.appliedThrough = page.readsThrough
    page.reads = new Map()
    page.readDeltas = []
    page.readsFrom = null
  }

  private async applyAction(action: SyncAction, summary: PullSummary, page: PageProgress) {
    switch (action.model) {
      case "subscription": {
        await this.applySubscriptionAction(action, summary, page)
        return
      }
      case "collection": {
        await this.applyCollectionAction(action)
        return
      }
      case "timeline": {
        this.applyNewEntriesAction(action, summary, page)
        return
      }
      case "inbox": {
        await this.applyInboxAction(action, summary, page)
        return
      }
      case "inbox_entry": {
        await this.applyInboxEntryAction(action, page)
        return
      }
      default: {
        await this.applyRegisteredModelAction(action)
      }
    }
  }

  private async applyRegisteredModelAction(action: SyncAction) {
    const handler = getSyncModelHandler(action.model)
    if (handler) {
      await handler.apply(action)
      return
    }

    // Nobody handles this model (yet). Forget that it was bootstrapped, so a handler that
    // registers later loads it in full instead of trusting a change log it never saw.
    if (this.unhandledModels.has(action.model)) return
    this.unhandledModels.add(action.model)
    await SyncMetaService.delete(modelBootstrappedKey(action.model)).catch(() => {})
  }

  private async applySubscriptionAction(
    action: SyncAction,
    summary: PullSummary,
    page: PageProgress,
  ) {
    if (!action.modelId || isOlderThanConfirmedChange(action)) return

    if (action.action === "I") {
      if (!isRecord(action.data) || !("feeds" in action.data)) return
      const { subscriptions, collections } = apiMorph.toSubscription([
        action.data as unknown as SubscriptionSyncPayload,
      ])
      await feedActions.upsertMany(collections.feeds)
      await subscriptionActions.upsertMany(subscriptions)
      for (const subscription of subscriptions) {
        addView(summary.invalidateViews, subscription.view)
      }
      summary.refreshUnread = true
      return
    }

    const current = getSubscriptionById(action.modelId)
    if (!current) return

    if (action.action === "U") {
      if (!isRecord(action.data)) return
      const patch = action.data as Partial<SubscriptionModel>
      const previousView = current.view
      subscriptionActions.patchInSession(getSubscriptionStoreId(current), patch)
      const next = getSubscriptionById(action.modelId)
      if (next) {
        await SubscriptionService.patch({
          id: getSubscriptionDBId(next),
          ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
        })
        if (next.view !== previousView) {
          addView(summary.invalidateViews, previousView)
          addView(summary.invalidateViews, next.view)
        }
      }
      return
    }

    if (action.action === "D") {
      // The row first: once the subscription is gone from memory, applying this again finds
      // nothing to delete.
      await SubscriptionService.delete([getSubscriptionDBId(current)])
      subscriptionActions.removeManyInSession([getSubscriptionStoreId(current)])
      if (current.feedId) {
        page.unread[current.feedId] = 0
      }
      addView(summary.invalidateViews, current.view)
    }
  }

  private async applyCollectionAction(action: SyncAction) {
    if (!action.modelId) return

    if (action.action === "I") {
      if (!isRecord(action.data)) return
      const data = action.data as unknown as CollectionActionData
      await collectionActions.upsertMany([
        {
          entryId: data.entryId ?? action.modelId,
          feedId: data.feedId,
          view: data.view as FeedViewType,
          createdAt: data.createdAt,
        },
      ])
      return
    }

    if (action.action === "D") {
      await collectionActions.delete(action.modelId)
    }
  }

  /** New entries ("N"); read actions ("U") are collected by `applyActions` */
  private applyNewEntriesAction(action: SyncAction, summary: PullSummary, page: PageProgress) {
    if (action.action !== "N" || !isRecord(action.data)) return
    const data = action.data as unknown as TimelineNewEntriesActionData
    const id = data.isInbox ? (data.inboxId ?? action.modelId) : (data.feedId ?? action.modelId)
    if (!id) return
    // A feed unfollowed here since then has no counter to add to.
    const subscription = data.isInbox ? undefined : getSubscriptionById(id)
    if (!data.isInbox && !subscription) return

    page.dirtyFeedIds.add(id)
    addView(summary.newEntryViews, data.isInbox ? FeedViewType.Articles : subscription?.view)
    const loggedAt = Date.parse(action.createdAt)
    if (Number.isFinite(loggedAt)) {
      summary.newestEntryAt = Math.max(summary.newestEntryAt, loggedAt)
    }

    // The last snapshot already counted everything logged up to its id.
    if (action.id <= this.unreadSnapshotSyncId) return
    unreadActions.moveCounts(page.unread, { [id]: data.unread })
  }

  private async applyInboxAction(action: SyncAction, summary: PullSummary, page: PageProgress) {
    const inboxId = action.modelId
    if (!inboxId) return

    if (action.action === "I") {
      if (!isRecord(action.data) || !("inboxes" in action.data)) return
      const { subscriptions, collections } = apiMorph.toSubscription([
        action.data as unknown as SubscriptionSyncPayload,
      ])
      await inboxActions.upsertMany(collections.inboxes)
      await subscriptionActions.upsertMany(subscriptions)
      return
    }

    if (action.action === "U") {
      if (!isRecord(action.data)) return
      const current = useInboxStore.getState().inboxes[inboxId]
      if (!current) return
      const title = typeof action.data.title === "string" ? action.data.title : null
      await inboxActions.upsertMany([{ id: current.id, secret: current.secret, title }])

      const subscription = getSubscriptionById(getInboxStoreId(inboxId))
      if (subscription) {
        subscriptionActions.patchInSession(getSubscriptionStoreId(subscription), { title })
        await SubscriptionService.patch({ id: getSubscriptionDBId(subscription), title })
      }
      return
    }

    if (action.action === "D") {
      const subscription = getSubscriptionById(getInboxStoreId(inboxId))
      if (subscription) {
        await SubscriptionService.delete([getSubscriptionDBId(subscription)])
        subscriptionActions.removeManyInSession([getSubscriptionStoreId(subscription)])
      }
      await InboxService.deleteById(inboxId)
      inboxActions.deleteById(inboxId)
      page.unread[inboxId] = 0
      addView(summary.invalidateViews, FeedViewType.Articles)
    }
  }

  private async applyInboxEntryAction(action: SyncAction, page: PageProgress) {
    if (action.action !== "D" || !action.modelId || !isRecord(action.data)) return

    const data = action.data as unknown as InboxEntryActionData
    await EntryService.deleteMany([action.modelId])
    entryActions.deleteInboxEntryById(action.modelId)
    page.dirtyFeedIds.add(data.inboxId)
    if (action.id <= this.unreadSnapshotSyncId || !data.unread) return
    unreadActions.moveCounts(page.unread, { [data.inboxId]: -1 })
  }

  private attachListeners() {
    if (this.listenersAttached) return
    this.listenersAttached = true

    transactionQueue.onAcknowledged(() => {
      this.schedulePull("ack", ACK_PULL_DELAY_MS)
    })

    // A launch before anyone is known to be signed in, such as on a fresh profile while the
    // session check runs, pulls nothing. Pull once someone is, rather than at the next focus
    // or interval: until then the engine has no cursor, and what relies on it falls short.
    useUserStore.subscribe((state, previous) => {
      if (state.whoami && !previous.whoami) this.schedulePull("launch")
    })

    this.intervalTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      void this.pull("interval")
    }, PULL_INTERVAL_MS)

    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("online", () => this.resume())
      // Switching back to a desktop window does not change the document's visibility, so
      // the window's own focus is the return signal there.
      globalThis.addEventListener("focus", () => this.resume())
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.resume()
      })
    }
  }
}

export const syncEngine = new SyncEngine()
registerSyncEngine(syncEngine)
