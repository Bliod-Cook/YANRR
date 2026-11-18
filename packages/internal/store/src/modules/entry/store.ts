import { FeedViewType } from "@follow/constants"
import { EntryService } from "@follow/database/services/entry"
import { isBizId } from "@follow/utils"
import { cloneDeep } from "es-toolkit"
import { debounce } from "es-toolkit/compat"

import type { EntryListRequest } from "../../api-contract"
import { api } from "../../context"
import type { Hydratable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { readNdjsonStream } from "../../lib/stream"
import { apiMorph } from "../../morph/api"
import { entryReadOverlayKey } from "../../sync/overlay-keys"
import { transactionQueue } from "../../sync/transaction-queue"
import { collectionActions } from "../collection/store"
import { clearAllFeedUnreadDirty, clearFeedUnreadDirty } from "../feed/hooks"
import { feedActions } from "../feed/store"
import { getSubscriptionById } from "../subscription/getter"
import type {
  FeedIdOrInboxHandle,
  InsertedBeforeTimeRangeFilter,
  PublishAtTimeRangeFilter,
} from "../unread/types"
import { getEntry } from "./getter"
import type {
  EntriesPageParam,
  EntryModel,
  FetchEntriesProps,
  FetchEntriesPropsSettings,
} from "./types"
import { getEffectiveEntrySortOrder, getEntriesParams, isTimelineEntriesSource } from "./utils"

type EntryId = string
type FeedId = string
type InboxId = string

interface EntryState {
  data: Record<EntryId, EntryModel>
  entryIdByView: Record<FeedViewType, Set<EntryId>>
  entryIdByFeed: Record<FeedId, Set<EntryId>>
  entryIdByInbox: Record<InboxId, Set<EntryId>>
  entryIdSet: Set<EntryId>
}

const defaultState: EntryState = {
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
  entryIdByFeed: {},
  entryIdByInbox: {},
  entryIdSet: new Set(),
}

export const useEntryStore = createZustandStore<EntryState>("entry")(() => defaultState)

const get = useEntryStore.getState
const immerSet = createImmerSetter(useEntryStore)

class EntryActions implements Hydratable {
  async hydrate() {
    const entries = await EntryService.getEntriesToHydrate()
    entryActions.upsertManyInSession(entries)
  }

  getFlattenMapEntries() {
    const state = get()
    return state.data
  }

  private addEntryIdToView({
    draft,
    feedId,
    entryId,
  }: {
    draft: EntryState
    feedId?: FeedId | null
    entryId: EntryId
  }) {
    if (!feedId) return

    const subscription = getSubscriptionById(feedId)
    if (!subscription?.hideFromTimeline) {
      if (typeof subscription?.view === "number") {
        draft.entryIdByView[subscription.view]?.add(entryId)
      }
      draft.entryIdByView[FeedViewType.All]!.add(entryId)
    }
  }

  private addEntryIdToFeed({
    draft,
    feedId,
    entryId,
  }: {
    draft: EntryState
    feedId?: FeedId | null
    entryId: EntryId
  }) {
    if (!feedId) return
    const entryIdSetByFeed = draft.entryIdByFeed[feedId]
    if (!entryIdSetByFeed) {
      draft.entryIdByFeed[feedId] = new Set([entryId])
    } else {
      entryIdSetByFeed.add(entryId)
    }
  }

  private addEntryIdToInbox({
    draft,
    inboxHandle,
    entryId,
  }: {
    draft: EntryState
    inboxHandle?: InboxId | null
    entryId: EntryId
  }) {
    if (!inboxHandle) return
    const entryIdSetByInbox = draft.entryIdByInbox[inboxHandle]
    if (!entryIdSetByInbox) {
      draft.entryIdByInbox[inboxHandle] = new Set([entryId])
    } else {
      entryIdSetByInbox.add(entryId)
    }
  }

  upsertManyInSession(entries: EntryModel[], options?: FetchEntriesPropsSettings) {
    if (entries.length === 0) return
    const { unreadOnly } = options || {}

    // Pending or just-acknowledged read marks win over the snapshot we received.
    const overlays = transactionQueue.getOverlays()

    immerSet((draft) => {
      for (const entry of entries) {
        const readOverride = overlays.get(entryReadOverlayKey(entry.id))
        const nextEntry =
          typeof readOverride === "boolean" && entry.read !== readOverride
            ? { ...entry, read: readOverride }
            : entry

        draft.entryIdSet.add(nextEntry.id)
        draft.data[nextEntry.id] = nextEntry

        const { feedId, inboxHandle, read } = nextEntry
        if (unreadOnly && read) continue

        if (inboxHandle) {
          this.addEntryIdToInbox({
            draft,
            inboxHandle,
            entryId: nextEntry.id,
          })
        } else {
          this.addEntryIdToFeed({
            draft,
            feedId,
            entryId: nextEntry.id,
          })
        }

        this.addEntryIdToView({
          draft,
          feedId,
          entryId: nextEntry.id,
        })
      }
    })
  }

  async upsertMany(entries: EntryModel[]) {
    const tx = createTransaction()
    tx.store(() => {
      this.upsertManyInSession(entries)
    })

    tx.persist(() => {
      return EntryService.upsertMany(entries)
    })

    await tx.run()
  }

  updateEntryContentInSession({
    entryId,
    content,
    readabilityContent,
    readabilityUpdatedAt,
  }: {
    entryId: EntryId
    content?: string
    readabilityContent?: string
    readabilityUpdatedAt?: Date
  }) {
    immerSet((draft) => {
      const entry = draft.data[entryId]
      if (!entry) return
      if (content) {
        entry.content = content
      }
      if (readabilityContent) {
        entry.readabilityContent = readabilityContent
        entry.readabilityUpdatedAt = readabilityUpdatedAt
      }
    })
  }

  async updateEntryContent({
    entryId,
    content,
    readabilityContent,
    readabilityUpdatedAt = new Date(),
  }: {
    entryId: EntryId
    content?: string
    readabilityContent?: string
    readabilityUpdatedAt?: Date
  }) {
    const tx = createTransaction()
    tx.store(() => {
      this.updateEntryContentInSession({
        entryId,
        content,
        readabilityContent,
        readabilityUpdatedAt,
      })
    })

    tx.persist(async () => {
      if (content) {
        await EntryService.patch({ id: entryId, content })
      }

      if (readabilityContent) {
        await EntryService.patch({ id: entryId, readabilityContent, readabilityUpdatedAt })
      }
    })

    await tx.run()
  }

  /** Store the contents of several entries in one store update. */
  async updateEntryContents(contents: { entryId: EntryId; content: string }[]) {
    const tx = createTransaction()
    tx.store(() => {
      immerSet((draft) => {
        for (const { entryId, content } of contents) {
          const entry = draft.data[entryId]
          if (entry && content) {
            entry.content = content
          }
        }
      })
    })

    tx.persist(async () => {
      await Promise.all(
        contents.flatMap(({ entryId, content }) =>
          content ? [EntryService.patch({ id: entryId, content })] : [],
        ),
      )
    })

    await tx.run()
  }

  /**
   * Entries whose read flag would change for the given selection, without mutating anything.
   */
  collectEntryIdsToMarkInSession({
    entryIds,
    ids,
    read,
    time,
  }: {
    entryIds?: EntryId[]
    ids?: FeedIdOrInboxHandle[]
    read: boolean
    time?: PublishAtTimeRangeFilter | InsertedBeforeTimeRangeFilter
  }): EntryId[] {
    const state = get()
    const matchesTime = (entry: EntryModel) => {
      if (time && "startTime" in time) {
        const publishedAt = +new Date(entry.publishedAt)
        if (publishedAt < time.startTime || publishedAt > time.endTime) return false
      }
      if (time && "insertedBefore" in time && +new Date(entry.insertedAt) >= time.insertedBefore) {
        return false
      }
      return true
    }

    const affected = new Set<EntryId>()

    if (entryIds) {
      for (const entryId of entryIds) {
        const entry = state.data[entryId]
        if (!entry || !matchesTime(entry)) continue
        if (entry.read !== read) affected.add(entryId)
      }
    }

    if (ids) {
      const idSet = new Set(ids)
      for (const entryId of state.entryIdSet) {
        const entry = state.data[entryId]
        if (!entry) continue
        const id = entry.inboxHandle || entry.feedId || ""
        if (!id || !idSet.has(id) || !matchesTime(entry)) continue
        if (entry.read !== read) affected.add(entryId)
      }
    }

    return Array.from(affected)
  }

  markEntryReadStatusInSession({
    entryIds,
    ids,
    read,
    time,
  }: {
    entryIds?: EntryId[]
    ids?: FeedIdOrInboxHandle[]
    read: boolean
    time?: PublishAtTimeRangeFilter | InsertedBeforeTimeRangeFilter
  }) {
    const affectedEntryIds = this.collectEntryIdsToMarkInSession({ entryIds, ids, read, time })
    if (affectedEntryIds.length === 0) return affectedEntryIds

    immerSet((draft) => {
      for (const entryId of affectedEntryIds) {
        const entry = draft.data[entryId]
        if (entry) {
          entry.read = read
        }
      }
    })

    return affectedEntryIds
  }

  /** Sets the read state of each entry, all in one store update */
  setEntriesReadInSession(readByEntryId: Map<EntryId, boolean>) {
    immerSet((draft) => {
      for (const [entryId, read] of readByEntryId) {
        const entry = draft.data[entryId]
        if (entry) {
          entry.read = read
        }
      }
    })
  }

  resetByView({ view, entries }: { view?: FeedViewType; entries: EntryModel[] }) {
    if (view === undefined) return
    immerSet((draft) => {
      draft.entryIdByView[view] = new Set(entries.map((e) => e.id))
    })
  }

  resetByFeed({ feedId, entries }: { feedId?: FeedId; entries: EntryModel[] }) {
    if (!feedId) return
    immerSet((draft) => {
      draft.entryIdByFeed[feedId] = new Set(entries.map((e) => e.id))
    })
  }

  resetByInbox({ inboxId, entries }: { inboxId?: InboxId; entries: EntryModel[] }) {
    if (!inboxId) return
    immerSet((draft) => {
      draft.entryIdByInbox[inboxId] = new Set(entries.map((e) => e.id))
    })
  }

  deleteInboxEntryById(entryId: EntryId) {
    const entry = get().data[entryId]
    if (!entry || !entry.inboxHandle) return

    immerSet((draft) => {
      delete draft.data[entryId]
      draft.entryIdSet.delete(entryId)
      draft.entryIdByInbox[entry.inboxHandle!]?.delete(entryId)
      draft.entryIdByView[FeedViewType.All]!.delete(entryId)
    })
  }
}

export const SEARCH_PAGE_SIZE = 20

/** The timeline a search is narrowed to, as the entries list takes it */
export type EntrySearchScope = Pick<
  EntryListRequest,
  "view" | "feedId" | "feedIdList" | "inboxId" | "isCollection"
>

class EntrySyncServices {
  /**
   * A page of the entries of the `scope` timeline, or else of every entry the user may read, that match `keyword`:
   * most terms in the title first, then newest, with where they matched and where they come from. They stay out of
   * the store, so that old results don't show up in the local timelines.
   */
  async searchEntries({
    keyword,
    pageParam,
    scope,
  }: {
    keyword: string
    pageParam?: EntriesPageParam
    scope?: EntrySearchScope
  }) {
    const res = await api().entries.list({
      keyword,
      limit: SEARCH_PAGE_SIZE,
      publishedAfter: pageParam?.time,
      cursorId: pageParam?.id,
      ...scope,
    })
    return apiMorph.toEntryList(res.data).map((entry, index) => ({
      entry,
      highlight: res.data[index]?.highlight ?? { title: [entry.title ?? ""], snippet: null },
      // A feed the user doesn't follow isn't in the store
      source: res.data[index]?.feeds,
    }))
  }

  async fetchEntries(props: FetchEntriesProps) {
    const {
      feedId,
      inboxId,
      view,
      read,
      limit,
      pageParam,
      isCollection,
      feedIdList,
      aiSort,
      sortOrder,
    } = props
    const params = getEntriesParams({
      feedId,
      inboxId,
      view,
      feedIdList,
    })
    const effectiveSortOrder = getEffectiveEntrySortOrder({
      sortOrder: aiSort ? "desc" : sortOrder,
      unreadOnly: read === false,
      isTimelineSource: isTimelineEntriesSource({
        feedId,
        inboxId: params.inboxId,
        isCollection: isCollection === true || params.isCollection === true,
      }),
    })

    const res = params.inboxId
      ? await api().entries.inbox.list({
          publishedAfter: pageParam?.time,
          cursorId: pageParam?.id,
          read,
          limit,
          isCollection,
          inboxId: params.inboxId,
          ...(aiSort && { aiSort }),
          ...params,
        })
      : await api().entries.list(
          {
            ...(effectiveSortOrder === "asc"
              ? { publishedBefore: pageParam?.time }
              : { publishedAfter: pageParam?.time }),
            cursorId: pageParam?.id,
            read,
            limit,
            isCollection,
            ...(aiSort && { aiSort }),
            ...(effectiveSortOrder && { sortOrder: effectiveSortOrder }),
            ...params,
          },
          aiSort
            ? {
                timeout: 3 * 60 * 1000,
              }
            : undefined,
        )

    // Mark feed unread dirty, so re-fetch the unread data when view feed unread entires in the next time
    if (read === false) {
      if (typeof params.view === "number" && !params.feedId) {
        clearAllFeedUnreadDirty()
      }
      if (params.feedId) {
        clearFeedUnreadDirty(params.feedId as string)
      }
      if (params.feedIdList) {
        params.feedIdList.forEach((feedId) => {
          clearFeedUnreadDirty(feedId)
        })
      }
    }

    const entries = apiMorph.toEntryList(res.data)
    const entriesInDB = await EntryService.getEntryMany(entries.map((e) => e.id))
    for (const entry of entries) {
      const entryInDB = entriesInDB.find((e) => e.id === entry.id)
      if (entryInDB) {
        entry.content = entryInDB.content
        entry.readabilityContent = entryInDB.readabilityContent
        entry.readabilityUpdatedAt = entryInDB.readabilityUpdatedAt
      }
    }

    await entryActions.upsertMany(entries)

    const { collections, entryIdsNotInCollections } = apiMorph.toCollections(res.data)
    const effectiveLimit = limit !== undefined ? Math.min(limit, 100) : 20
    const shouldResetCollection =
      (params.isCollection || isCollection) &&
      read === undefined &&
      !pageParam &&
      entries.length < effectiveLimit
    await collectionActions.reconcileFromRemote({
      collections,
      entryIdsNotInCollections,
      // A full reset is only safe once the first page proves there are no more collection rows.
      reset: shouldResetCollection,
      view: view === FeedViewType.All ? undefined : view,
    })

    const dataFeeds = res.data?.map((e) => e.feeds).filter((f) => f.type === "feed")
    const feeds = dataFeeds?.map((f) => apiMorph.toFeed(f)) ?? []
    await feedActions.upsertMany(feeds)

    return res
  }

  async fetchEntryDetail(entryId: EntryId | undefined, isInbox?: boolean) {
    if (!isBizId(entryId)) return null

    const currentEntry = getEntry(entryId)
    const res =
      currentEntry?.inboxHandle || isInbox
        ? await api().entries.inbox.get({ id: entryId })
        : await api().entries.get({ id: entryId })
    const entry = apiMorph.toEntry(res.data, currentEntry)
    if (!currentEntry && entry) {
      await entryActions.upsertMany([entry])
    } else {
      if (entry?.content && currentEntry?.content !== entry.content) {
        await entryActions.updateEntryContent({ entryId, content: entry.content })
      }
      if (
        entry?.readabilityContent &&
        currentEntry?.readabilityContent !== entry.readabilityContent
      ) {
        await entryActions.updateEntryContent({
          entryId,
          readabilityContent: entry.readabilityContent,
        })
      }
    }
    return entry
  }

  async fetchEntryReadabilityContent(entryId: EntryId) {
    const entry = getEntry(entryId)
    if (!entry?.url) return entry
    if (
      entry.readabilityContent &&
      entry.readabilityUpdatedAt &&
      entry.readabilityUpdatedAt.getTime() > Date.now() - 1000 * 60 * 60 * 24 * 3
    ) {
      return entry
    }

    const { data } = await api().entries.readability({
      id: entryId,
    })
    const readabilityContent = data?.content
    if (readabilityContent) {
      await entryActions.updateEntryContent({
        entryId,
        readabilityContent,
      })
    }
    return entry
  }

  /**
   * Entries whose content was asked for this session. An entry the server has no content for
   * would otherwise come first in every batch and keep the ones after it from ever being fetched;
   * opening it still loads it in full. Entries of a failed request are asked for again.
   */
  private contentRequested = new Set<string>()

  async fetchEntryContentByStream(remoteEntryIds?: string[]) {
    if (!remoteEntryIds || remoteEntryIds.length === 0) return

    const nextIds = remoteEntryIds
      .filter((id) => !getEntry(id)?.content && !this.contentRequested.has(id))
      .slice(0, 30)
    if (nextIds.length === 0) return
    for (const id of nextIds) this.contentRequested.add(id)

    try {
      await this.readContentStream(nextIds)
    } catch (error) {
      for (const id of nextIds) this.contentRequested.delete(id)
      console.error("Failed to fetch entry contents:", error)
    }
  }

  private async readContentStream(ids: string[]) {
    const response = await api().entries.stream({ ids })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`)
    }

    // The lines of one network chunk are stored together, so a batch of entries updates the
    // store, and every timeline selector over it, once per chunk instead of once per entry
    let pending: { entryId: string; content: string }[] = []
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const writes: Promise<void>[] = []
    const flush = () => {
      flushTimer = undefined
      const contents = pending
      pending = []
      if (contents.length > 0) {
        const write = entryActions.updateEntryContents(contents)
        // Its failure is reported once the stream is read
        write.catch(() => {})
        writes.push(write)
      }
    }

    await readNdjsonStream<{ id: string; content: string }>(response, (json) => {
      pending.push({ entryId: json.id, content: json.content })
      flushTimer ??= setTimeout(flush, 0)
    })
    clearTimeout(flushTimer)
    flush()
    await Promise.all(writes)
  }

  async deleteInboxEntry(entryId: string) {
    const entry = get().data[entryId]
    if (!entry || !entry.inboxHandle) return
    const tx = createTransaction()
    const currentEntry = cloneDeep(entry)

    tx.store(() => {
      entryActions.deleteInboxEntryById(entryId)
    })
    tx.request(async () => {
      await api().entries.inbox.delete({ entryId })
    })
    tx.rollback(() => {
      entryActions.upsertManyInSession([currentEntry])
    })
    tx.persist(() => {
      return EntryService.deleteMany([entryId])
    })
    await tx.run()
  }
}

export const entrySyncServices = new EntrySyncServices()
export const entryActions = new EntryActions()
export const debouncedFetchEntryContentByStream = debounce(
  (ids?: string[]) => entrySyncServices.fetchEntryContentByStream(ids),
  1000,
)
