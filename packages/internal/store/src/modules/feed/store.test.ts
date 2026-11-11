import { FeedService } from "@follow/database/services/feed"
import { SyncMetaService } from "@follow/database/services/sync-meta"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FollowAPI } from "../../api-contract"
import { apiContext } from "../../context"
import { findFeedByUrl, getFeedByUrl } from "./getter"
import { feedActions, feedSyncServices, useFeedStore } from "./store"
import type { FeedModel } from "./types"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

const RESOLVED_URLS_KEY = "feed:resolved-urls"

const resetFeeds = () =>
  Promise.all([
    useFeedStore.setState({ feeds: {}, resolvedUrls: {} }),
    FeedService.reset(),
    SyncMetaService.delete(RESOLVED_URLS_KEY),
  ])

const feed = (patch: Partial<FeedModel>) =>
  ({
    type: "feed",
    id: "feed-1",
    title: "Feed",
    url: "https://example.com/feed.xml",
    ...patch,
  }) as FeedModel

const storedResolvedUrls = async () =>
  JSON.parse((await SyncMetaService.get(RESOLVED_URLS_KEY)) ?? "{}") as Record<string, string>

describe("feedSyncServices.fetchFeed", () => {
  const getFeed = vi.fn()

  beforeEach(async () => {
    await resetFeeds()
    getFeed.mockResolvedValue({ data: { feed: feed({ id: "1328554886337265664" }) } })
    apiContext.provide({ feeds: { get: getFeed } } as unknown as FollowAPI)
  })

  it.each([{ id: "1328554886337265664" }, { url: "https://example.com/feed.xml" }])(
    "waits for the server, which gives the feed's source 70 s, to say why it failed: %o",
    async (params) => {
      await feedSyncServices.fetchFeed(params)

      const [, options] = getFeed.mock.calls[0] as [unknown, { timeout?: number } | undefined]
      expect(options?.timeout).toBeGreaterThan(70_000)
    },
  )

  it("stores the feed", async () => {
    await feedSyncServices.fetchFeed({ id: "1328554886337265664" })

    expect(useFeedStore.getState().feeds["1328554886337265664"]?.title).toBe("Feed")
    expect(await FeedService.getFeedAll()).toMatchObject([{ id: "1328554886337265664" }])
  })
})

describe("a feed the server keeps under another URL than its address", () => {
  const address = "http://localhost:1200/test/sort"
  const url = "rsshub://test/sort"

  beforeEach(async () => {
    await resetFeeds()
    const getFeed = vi.fn(async () => ({ data: { feed: feed({ id: "feed-sort", url }) } }))
    apiContext.provide({ feeds: { get: getFeed } } as unknown as FollowAPI)
  })

  it("is found by its address once it was looked up", async () => {
    expect(getFeedByUrl(address)).toBeUndefined()

    await feedSyncServices.fetchFeed({ url: address })

    expect(getFeedByUrl(address)?.id).toBe("feed-sort")
    expect(getFeedByUrl(url)?.id).toBe("feed-sort")
  })

  it("matches only the URL its address was looked up as", () => {
    const state = {
      feeds: { sort: feed({ id: "sort", url }), other: feed({ id: "other", url: address }) },
      resolvedUrls: { [address]: url },
    }

    expect(findFeedByUrl(state, address)?.id).toBe("sort")
    expect(findFeedByUrl(state, "http://localhost:1200/test/other")).toBeUndefined()
    expect(findFeedByUrl({ ...state, resolvedUrls: {} }, address)?.id).toBe("other")
  })

  it("is still found by its address after the app restarts", async () => {
    await feedSyncServices.fetchFeed({ url: address })

    // A new launch starts from what the database holds
    useFeedStore.setState({ feeds: {}, resolvedUrls: {} })
    await feedActions.hydrate()

    expect(getFeedByUrl(address)?.id).toBe("feed-sort")
  })

  it("keeps only the most recently resolved addresses", async () => {
    for (let index = 0; index <= 100; index++) {
      await feedActions.setResolvedUrl(`http://localhost:1200/test/${index}`, `rsshub://${index}`)
    }
    // Resolving an address again makes it the most recent one
    await feedActions.setResolvedUrl("http://localhost:1200/test/1", "rsshub://one")

    const stored = await storedResolvedUrls()
    expect(Object.keys(stored)).toHaveLength(100)
    expect(stored).not.toHaveProperty(["http://localhost:1200/test/0"])
    expect(Object.entries(stored).at(-1)).toEqual(["http://localhost:1200/test/1", "rsshub://one"])
    expect(useFeedStore.getState().resolvedUrls).toEqual(stored)
  })
})
