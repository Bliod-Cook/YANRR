import type { FeedSchema } from "@follow/database/schemas/types"
import { FeedService } from "@follow/database/services/feed"
import { SyncMetaService } from "@follow/database/services/sync-meta"
import { isBizId } from "@follow/utils"

import { api } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { apiMorph } from "../../morph/api"
import type { FeedModel } from "./types"

export interface FeedState {
  feeds: Record<string, FeedModel>
  /**
   * The URL of the feed an address was looked up as, keyed by that address where they differ.
   * The server keeps the feed of an RSSHub instance address such as
   * http://localhost:1200/test/sort as rsshub://test/sort.
   */
  resolvedUrls: Record<string, string>
}

const initialFeedStore: FeedState = {
  feeds: {},
  resolvedUrls: {},
}

export const useFeedStore = createZustandStore<FeedState>("feed")(() => initialFeedStore)

const get = useFeedStore.getState
const set = useFeedStore.setState
const immerSet = createImmerSetter(useFeedStore)

// The server fetches a feed it has not stored yet and gives its source 70 s before it answers
// with an error that says so. A shorter timeout here would replace that answer with its own.
const FEED_LOOKUP_TIMEOUT_MS = 90_000

/**
 * The resolved URLs are kept across launches, so a feed followed by an RSSHub instance address
 * is still found by it. The table belongs to the signed-in account and is cleared with it.
 */
const RESOLVED_URLS_KEY = "feed:resolved-urls"
// Only the most recently resolved addresses are kept
const MAX_RESOLVED_URLS = 100

const readResolvedUrls = async (): Promise<Record<string, string>> => {
  try {
    const stored = await SyncMetaService.get(RESOLVED_URLS_KEY)
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    )
  } catch (error) {
    console.error("[feed] failed to load the resolved URLs", error)
    return {}
  }
}

class FeedActions implements Hydratable, Resetable {
  async hydrate() {
    const [feeds, resolvedUrls] = await Promise.all([FeedService.getFeedAll(), readResolvedUrls()])
    feedActions.upsertManyInSession(feeds)
    immerSet((draft) => {
      // Addresses already looked up in this session are the newer ones
      draft.resolvedUrls = { ...resolvedUrls, ...draft.resolvedUrls }
    })
  }

  upsertManyInSession(feeds: FeedSchema[]) {
    immerSet((draft) => {
      for (const feed of feeds) {
        draft.feeds[feed.id] = { ...feed, type: "feed" }
      }
    })
  }

  async upsertMany(feeds: FeedSchema[]) {
    if (feeds.length === 0) return

    const tx = createTransaction()
    tx.store(() => {
      this.upsertManyInSession(feeds)
    })

    tx.persist(() => FeedService.upsertMany(feeds))

    await tx.run()
  }

  /** Remember the URL of the feed the server found for an address, also for later launches */
  async setResolvedUrl(address: string | undefined, feedUrl: string | undefined) {
    if (!address || !feedUrl || address === feedUrl) return
    if (get().resolvedUrls[address] === feedUrl) return
    immerSet((draft) => {
      // The latest address goes last, so the oldest ones are dropped first
      delete draft.resolvedUrls[address]
      draft.resolvedUrls[address] = feedUrl
      const addresses = Object.keys(draft.resolvedUrls)
      for (const stale of addresses.slice(0, Math.max(0, addresses.length - MAX_RESOLVED_URLS))) {
        delete draft.resolvedUrls[stale]
      }
    })

    await SyncMetaService.set(RESOLVED_URLS_KEY, JSON.stringify(get().resolvedUrls)).catch(
      (error) => {
        console.error("[feed] failed to store the resolved URLs", error)
      },
    )
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(initialFeedStore)
    })

    tx.persist(async () => {
      await Promise.all([
        FeedService.reset(),
        SyncMetaService.delete(RESOLVED_URLS_KEY).catch((error) => {
          console.error("[feed] failed to clear the resolved URLs", error)
        }),
      ])
    })

    await tx.run()
  }
}

type FeedQueryParams = {
  id?: string
  url?: string
}

class FeedSyncServices {
  /** The feed with the id, or else at the URL, which the server fetches and stores if it has not yet */
  async fetchFeed({ id, url }: FeedQueryParams) {
    if (!url && !isBizId(id)) return null

    const res = await api().feeds.get({ id, url }, { timeout: FEED_LOOKUP_TIMEOUT_MS })
    await feedActions.upsertMany([apiMorph.toFeed(res.data.feed)])
    await feedActions.setResolvedUrl(url, res.data.feed.url)
    return res.data
  }
}
export const feedSyncServices = new FeedSyncServices()
export const feedActions = new FeedActions()
