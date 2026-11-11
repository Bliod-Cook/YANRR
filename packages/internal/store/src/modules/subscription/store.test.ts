import { FeedViewType } from "@follow/constants"
import { db } from "@follow/database/db"
import { FeedService } from "@follow/database/services/feed"
import { SubscriptionService } from "@follow/database/services/subscription"
import { UnreadService } from "@follow/database/services/unread"
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, test, vi } from "vitest"

import type { FollowAPI } from "../../api-contract"
import { apiContext, queryClientContext } from "../../context"
import type { SyncEngineHandle } from "../../sync/sync-status"
import { registerSyncEngine } from "../../sync/sync-status"
import { transactionQueue } from "../../sync/transaction-queue"
import { getFeedByIdOrUrl } from "../feed/getter"
import { feedSyncServices, useFeedStore } from "../feed/store"
import type { FeedModel } from "../feed/types"
import { useUnreadStore } from "../unread/store"
import {
  getCategoriesByViewSelector,
  getSortedGroupedSubscriptionSelector,
  getSubscriptionByFeedId,
} from "./getter"
import {
  getConfirmedSubscriptionChange,
  subscriptionActions,
  subscriptionSyncService,
  useSubscriptionStore,
} from "./store"
import type { SubscriptionModel } from "./types"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

const mocks = vi.hoisted(() => ({
  deleteSubscriptions: vi.fn(),
  batchUpdate: vi.fn(),
  update: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  create: vi.fn(),
  getSubscriptions: vi.fn(),
}))

vi.mock("i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("i18next")>()),
  t: (key: string) => key,
}))

const createSubscription = (
  feedId: string,
  view: FeedViewType,
  category: string | null,
): SubscriptionModel => ({
  feedId,
  inboxId: null,
  userId: "user",
  view,
  hideFromTimeline: null,
  title: null,
  category,
  createdAt: new Date(0).toISOString(),
  type: "feed",
})

/** Subscriptions as a launch hydrates them from the database */
const seed = async (subscriptions: SubscriptionModel[]) => {
  useSubscriptionStore.setState(useSubscriptionStore.getInitialState(), true)
  await subscriptionActions.upsertMany(subscriptions, { reset: true })
}

/** The app quits and starts again on the same database */
const restart = async () => {
  useSubscriptionStore.setState(useSubscriptionStore.getInitialState(), true)
  await subscriptionActions.hydrate()
}

const storedCategories = async () =>
  Object.fromEntries(
    (await db.query.subscriptionsTable.findMany()).map((row) => [row.feedId, row.category]),
  )

const categoriesOf = (view: FeedViewType) =>
  [...getCategoriesByViewSelector(useSubscriptionStore.getState())(view)].sort()

describe("subscriptionSyncService", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Follows and unfollows confirmed by an earlier test
    transactionQueue.clearInSession()
    await Promise.all([SubscriptionService.reset(), FeedService.reset(), UnreadService.reset()])
    mocks.batchUpdate.mockResolvedValue({ code: 0 })
    mocks.updateCategory.mockResolvedValue({ code: 0 })
    mocks.deleteCategory.mockResolvedValue({ code: 0 })
    mocks.update.mockResolvedValue({ code: 0 })
    mocks.deleteSubscriptions.mockResolvedValue({ code: 0 })
    queryClientContext.provide(new QueryClient())
    apiContext.provide({
      subscriptions: {
        batchUpdate: mocks.batchUpdate,
        create: mocks.create,
        delete: mocks.deleteSubscriptions,
        update: mocks.update,
        get: mocks.getSubscriptions,
      },
      categories: { update: mocks.updateCategory, delete: mocks.deleteCategory },
    } as unknown as FollowAPI)
  })

  test("skips a subscription in a view the app has no list for, keeping the others", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await seed([])

    subscriptionActions.upsertManyInSession([
      createSubscription("a", FeedViewType.Articles, "Tech"),
      createSubscription("broken", 99 as FeedViewType, "Tech"),
      createSubscription("b", FeedViewType.Pictures, null),
    ])

    const state = useSubscriptionStore.getState()
    expect(Object.keys(state.data).sort()).toEqual(["a", "b"])
    expect([...state.feedIdByView[FeedViewType.All]].sort()).toEqual(["a", "b"])

    // A change to such a view keeps the subscription where it is
    subscriptionActions.patchInSession("a", { view: 99 as FeedViewType, title: "Renamed" })
    expect(useSubscriptionStore.getState().data.a).toMatchObject({
      view: FeedViewType.Articles,
      title: "Renamed",
    })
    expect(useSubscriptionStore.getState().feedIdByView[FeedViewType.Articles].has("a")).toBe(true)
  })

  test("takes feeds out of their category when the category is null", async () => {
    await seed([
      createSubscription("a", FeedViewType.Articles, "Tech"),
      createSubscription("b", FeedViewType.Articles, "News"),
      createSubscription("c", FeedViewType.Articles, "News"),
    ])

    await subscriptionSyncService.batchUpdateSubscription({
      feedIds: ["a", "b"],
      category: null,
      view: FeedViewType.Articles,
    })

    const state = useSubscriptionStore.getState()
    expect(state.data.a!.category).toBeNull()
    expect(state.data.b!.category).toBeNull()
    expect(state.data.c!.category).toBe("News")
    expect(categoriesOf(FeedViewType.Articles)).toEqual(["News"])
    expect(await storedCategories()).toEqual({ a: null, b: null, c: "News" })
  })

  test("keeps the category when only the view changes", async () => {
    await seed([createSubscription("a", FeedViewType.Articles, "Tech")])

    await subscriptionSyncService.batchUpdateSubscription({
      feedIds: ["a"],
      view: FeedViewType.Pictures,
    })

    const state = useSubscriptionStore.getState()
    expect(state.data.a!.view).toBe(FeedViewType.Pictures)
    expect(state.data.a!.category).toBe("Tech")
    expect(categoriesOf(FeedViewType.Articles)).toEqual([])
    expect(categoriesOf(FeedViewType.Pictures)).toEqual(["Tech"])
  })

  test("renames a folder of the All view in every view it spans", async () => {
    await seed([
      createSubscription("a", FeedViewType.Articles, "Tech"),
      createSubscription("b", FeedViewType.Pictures, "Tech"),
    ])

    await subscriptionSyncService.renameCategory({
      lastCategory: "Tech",
      newCategory: "Science",
      view: FeedViewType.All,
    })

    const state = useSubscriptionStore.getState()
    expect(state.data.a!.category).toBe("Science")
    expect(state.data.b!.category).toBe("Science")
    expect(categoriesOf(FeedViewType.Articles)).toEqual(["Science"])
    expect(categoriesOf(FeedViewType.Pictures)).toEqual(["Science"])
    expect(categoriesOf(FeedViewType.All)).toEqual(["Science"])
    expect(mocks.updateCategory).toHaveBeenCalledWith({
      from: "Tech",
      to: "Science",
      view: FeedViewType.All,
    })
  })

  test("names the feeds of an auto-grouped folder, which have no category on the server", async () => {
    useFeedStore.setState({
      feeds: {
        a: {
          type: "feed",
          id: "a",
          url: "https://example.com/a.xml",
          siteUrl: "https://example.com",
        },
        b: {
          type: "feed",
          id: "b",
          url: "https://example.com/b.xml",
          siteUrl: "https://example.com",
        },
      } as unknown as Record<string, FeedModel>,
    })
    // "a" is in the folder by its site, "b" by name
    await seed([
      createSubscription("a", FeedViewType.Articles, null),
      createSubscription("b", FeedViewType.Articles, "Example.com"),
    ])

    try {
      await subscriptionSyncService.renameCategory({
        lastCategory: "Example.com",
        newCategory: "Blogs",
        view: FeedViewType.Articles,
      })
    } finally {
      useFeedStore.setState({ feeds: {} })
    }

    expect(mocks.updateCategory).toHaveBeenCalledWith({ feedIdList: ["a", "b"], category: "Blogs" })
    const state = useSubscriptionStore.getState()
    expect(state.data.a!.category).toBe("Blogs")
    expect(state.data.b!.category).toBe("Blogs")
  })

  test("sends only the fields an edit changed, so another device's edit is kept", async () => {
    // The local copy still has the category another device just changed.
    await seed([{ ...createSubscription("a", FeedViewType.Articles, "World"), title: null }])

    await subscriptionSyncService.edit({
      ...createSubscription("a", FeedViewType.Articles, "World"),
      title: "BBC W",
    })

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith({ title: "BBC W", feedId: "a" })
    expect(useSubscriptionStore.getState().data.a).toMatchObject({
      title: "BBC W",
      category: "World",
    })
  })

  test("moves a feed to another category, and forgets the one it left", async () => {
    await seed([createSubscription("a", FeedViewType.Articles, "News")])

    await subscriptionSyncService.edit({
      ...createSubscription("a", FeedViewType.Articles, "News"),
      category: "Blogs",
    })

    expect(mocks.update).toHaveBeenCalledWith({ category: "Blogs", feedId: "a" })
    expect(useSubscriptionStore.getState().data.a!.category).toBe("Blogs")
    expect(categoriesOf(FeedViewType.Articles)).toEqual(["Blogs"])
    expect(await storedCategories()).toEqual({ a: "Blogs" })
  })

  test("puts the category back when the server refuses the move", async () => {
    await seed([createSubscription("a", FeedViewType.Articles, "News")])
    mocks.update.mockRejectedValue(new Error("Network error"))

    await expect(
      subscriptionSyncService.edit({
        ...createSubscription("a", FeedViewType.Articles, "News"),
        category: "Blogs",
      }),
    ).rejects.toThrow("Network error")

    expect(useSubscriptionStore.getState().data.a!.category).toBe("News")
    expect(categoriesOf(FeedViewType.Articles)).toEqual(["News"])
  })

  test("sends nothing when a form only spells the same values differently", async () => {
    await seed([createSubscription("a", FeedViewType.Articles, null)])

    await subscriptionSyncService.edit({
      ...createSubscription("a", FeedViewType.Articles, null),
      category: "",
      title: "",
      hideFromTimeline: undefined,
    })

    expect(mocks.update).not.toHaveBeenCalled()
    expect(useSubscriptionStore.getState().data.a!.category).toBeNull()
  })

  test("renames the feeds another device moved into the category since the last pull", async () => {
    await seed([
      createSubscription("a", FeedViewType.Articles, "CatB2"),
      createSubscription("b", FeedViewType.Articles, null),
    ])
    const catchUp = vi.fn(async () => {
      // The pull brings the other device's move of "b" into the category.
      subscriptionActions.patchInSession("b", { category: "CatB2" })
      return true
    })
    registerSyncEngine({ catchUp } as unknown as SyncEngineHandle)

    try {
      await subscriptionSyncService.renameCategory({
        lastCategory: "CatB2",
        newCategory: "CatB3",
        view: FeedViewType.Articles,
      })
    } finally {
      registerSyncEngine(null)
    }

    expect(catchUp).toHaveBeenCalledTimes(1)
    // By name, so the server also renames a feed moved in after the pull
    expect(mocks.updateCategory).toHaveBeenCalledWith({
      from: "CatB2",
      to: "CatB3",
      view: FeedViewType.Articles,
    })
    const state = useSubscriptionStore.getState()
    expect(state.data.b!.category).toBe("CatB3")
    expect(categoriesOf(FeedViewType.Articles)).toEqual(["CatB3"])
  })

  test("leaves out a feed another device took out of the category since the last pull", async () => {
    await seed([
      createSubscription("a", FeedViewType.Articles, "Tech"),
      createSubscription("c", FeedViewType.Articles, "Tech"),
    ])
    registerSyncEngine({
      catchUp: async () => {
        // In memory only, as the pull's own write to the database is not part of this test
        subscriptionActions.patchInSession("c", { category: "Other" })
        return true
      },
    } as unknown as SyncEngineHandle)

    try {
      await subscriptionSyncService.renameCategory({
        lastCategory: "Tech",
        newCategory: "Science",
        view: FeedViewType.Articles,
      })
    } finally {
      registerSyncEngine(null)
    }

    expect(mocks.updateCategory).toHaveBeenCalledWith({
      from: "Tech",
      to: "Science",
      view: FeedViewType.Articles,
    })
    expect(useSubscriptionStore.getState().data.c!.category).toBe("Other")
    expect(await storedCategories()).toEqual({ a: "Science", c: "Tech" })
  })

  test("renames at once and does not wait long for the pull on a slow network", async () => {
    await seed([createSubscription("a", FeedViewType.Articles, "Tech")])
    vi.useFakeTimers()
    registerSyncEngine({
      catchUp: () => new Promise<boolean>(() => {}),
    } as unknown as SyncEngineHandle)

    try {
      const rename = subscriptionSyncService.renameCategory({
        lastCategory: "Tech",
        newCategory: "Science",
        view: FeedViewType.Articles,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(useSubscriptionStore.getState().data.a!.category).toBe("Science")
      expect(mocks.updateCategory).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(2000)
      await rename
    } finally {
      registerSyncEngine(null)
      vi.useRealTimers()
    }

    expect(mocks.updateCategory).toHaveBeenCalledWith({
      from: "Tech",
      to: "Science",
      view: FeedViewType.Articles,
    })
  })

  test("forgets a category renamed on another device once no feed uses it", async () => {
    await seed([
      createSubscription("a", FeedViewType.Articles, "CatB4"),
      createSubscription("b", FeedViewType.Articles, "CatB4"),
      createSubscription("c", FeedViewType.Pictures, "CatB4"),
    ])

    // The change log delivers the rename as one category change per feed.
    subscriptionActions.patchInSession("a", { category: "CatB5" })
    expect(categoriesOf(FeedViewType.Articles)).toEqual(["CatB4", "CatB5"])

    subscriptionActions.patchInSession("b", { category: "CatB5" })
    expect(categoriesOf(FeedViewType.Articles)).toEqual(["CatB5"])
    // Another view still has a folder of that name.
    expect(categoriesOf(FeedViewType.Pictures)).toEqual(["CatB4"])
    expect(categoriesOf(FeedViewType.All)).toEqual(["CatB4", "CatB5"])

    subscriptionActions.patchInSession("c", { category: "CatB5" })
    expect(categoriesOf(FeedViewType.All)).toEqual(["CatB5"])
  })

  test("keeps a category its other feeds still use when one of them is unfollowed", async () => {
    await seed([
      createSubscription("a", FeedViewType.Articles, "News"),
      createSubscription("b", FeedViewType.Articles, "News"),
    ])

    await subscriptionSyncService.unsubscribe(["a"])

    expect(categoriesOf(FeedViewType.Articles)).toEqual(["News"])
    expect(categoriesOf(FeedViewType.All)).toEqual(["News"])

    subscriptionActions.removeManyInSession(["b"])
    expect(categoriesOf(FeedViewType.Articles)).toEqual([])
  })

  test("unfollows the selected feeds in one request", async () => {
    await seed([
      createSubscription("feed1", FeedViewType.Articles, null),
      createSubscription("feed2", FeedViewType.Articles, null),
    ])
    let syncId = 40
    mocks.deleteSubscriptions.mockImplementation(async () => ({ code: 0, lastSyncId: ++syncId }))

    await subscriptionSyncService.unsubscribe(["feed1", "feed2"])

    expect(mocks.deleteSubscriptions.mock.calls).toEqual([[{ feedIdList: ["feed1", "feed2"] }]])
    const state = useSubscriptionStore.getState()
    expect(Object.keys(state.data)).toEqual([])
    expect([...state.feedIdByView[FeedViewType.Articles]]).toEqual([])
    expect(await storedCategories()).toEqual({})
    // The unfollows stay confirmed until the change log reaches the request's sync id
    expect(getConfirmedSubscriptionChange("feed1")).toEqual({ subscription: null, syncId: 41 })
    expect(getConfirmedSubscriptionChange("feed2")).toEqual({ subscription: null, syncId: 41 })
  })

  test("puts the selection back when its unfollow failed", async () => {
    await seed([
      createSubscription("leaving", FeedViewType.Articles, null),
      createSubscription("failing", FeedViewType.Articles, null),
    ])
    const error = new Error("Network error")
    // The server unfollows the feeds of one request together, or none of them
    mocks.deleteSubscriptions.mockRejectedValue(error)

    await expect(subscriptionSyncService.unsubscribe(["leaving", "failing"])).rejects.toBe(error)

    const state = useSubscriptionStore.getState()
    expect(Object.keys(state.data).sort()).toEqual(["failing", "leaving"])
    expect(state.feedIdByView[FeedViewType.Articles].has("failing")).toBe(true)
    expect(state.feedIdByView[FeedViewType.Articles].has("leaving")).toBe(true)
    expect(await storedCategories()).toEqual({ leaving: null, failing: null })
    expect(getConfirmedSubscriptionChange("failing")).toBeUndefined()
    expect(getConfirmedSubscriptionChange("leaving")).toBeUndefined()
  })

  test("puts the selection back when something else than the server answered its unfollow", async () => {
    await seed([createSubscription("leaving", FeedViewType.Articles, null)])
    mocks.deleteSubscriptions.mockResolvedValue("<html>Sign in</html>")

    await expect(subscriptionSyncService.unsubscribe(["leaving"])).rejects.toThrow("not the server")

    expect(Object.keys(useSubscriptionStore.getState().data)).toEqual(["leaving"])
    expect(getConfirmedSubscriptionChange("leaving")).toBeUndefined()
  })

  test("fails a follow the server answered without what it followed, storing nothing", async () => {
    const url = "https://example.com/new-feed.xml"
    await seed([])
    mocks.create.mockResolvedValue({ code: 0, feed: null, unread: {} })

    await expect(
      subscriptionSyncService.subscribe({
        url,
        feedId: undefined,
        view: FeedViewType.Articles,
        category: null,
        hideFromTimeline: null,
        title: null,
      }),
    ).rejects.toThrow("feed.follow_failed")

    expect(useSubscriptionStore.getState().data).toEqual({})
    expect(await storedCategories()).toEqual({})
  })

  test("fails a follow answered by something else than the server, storing nothing", async () => {
    await seed([])
    mocks.create.mockResolvedValue("<html>Sign in</html>")

    await expect(
      subscriptionSyncService.subscribe({
        url: "https://example.com/new-feed.xml",
        feedId: undefined,
        view: FeedViewType.Articles,
        category: null,
        hideFromTimeline: null,
        title: null,
      }),
    ).rejects.toThrow("not the server")

    expect(useSubscriptionStore.getState().data).toEqual({})
    expect(await storedCategories()).toEqual({})
  })

  test("finds the subscription of a feed followed by its RSSHub instance address", async () => {
    const address = "http://localhost:1200/test/sort"
    const url = "rsshub://test/sort"
    useFeedStore.setState({ feeds: {}, resolvedUrls: {} })
    await seed([])
    const getFeed = vi.fn(async () => ({
      data: { feed: { type: "feed", id: "feed-sort", title: "", url } },
    }))
    apiContext.provide({
      feeds: { get: getFeed },
      subscriptions: { create: mocks.create },
    } as unknown as FollowAPI)
    mocks.create.mockResolvedValue({
      code: 0,
      feed: { type: "feed", id: "feed-sort", url, title: "Sort" },
      unread: {},
    })

    const { feed } = (await feedSyncServices.fetchFeed({ url: address }))!
    await subscriptionSyncService.subscribe({
      url: feed.url,
      feedId: feed.id,
      view: FeedViewType.Articles,
      category: null,
      hideFromTimeline: null,
      title: null,
    })

    // A search result for the typed address looks the feed up by that address
    const feedId = getFeedByIdOrUrl({ url: address })?.id
    expect(feedId).toBe("feed-sort")
    expect(getSubscriptionByFeedId(feedId)?.feedId).toBe("feed-sort")
  })

  test("replaces the subscriptions of a view with the server's list, in memory and on disk", async () => {
    await seed([
      createSubscription("article", FeedViewType.Articles, null),
      createSubscription("dropped", FeedViewType.Articles, null),
      createSubscription("picture", FeedViewType.Pictures, null),
    ])
    mocks.getSubscriptions.mockResolvedValue({
      code: 0,
      data: [
        {
          ...createSubscription("article", FeedViewType.Articles, null),
          feeds: { type: "feed", id: "article", url: "https://example.com/feed.xml" },
        },
      ],
    })

    await subscriptionSyncService.fetch(FeedViewType.Articles)

    const expectOnlyKept = () => {
      const state = useSubscriptionStore.getState()
      expect([...state.subscriptionIdSet].sort()).toEqual(["feed/article", "feed/picture"])
      expect(Object.keys(state.data).sort()).toEqual(["article", "picture"])
      expect([...state.feedIdByView[FeedViewType.All]].sort()).toEqual(["article", "picture"])
    }
    expectOnlyKept()
    // The feed the server dropped does not come back with the next launch
    await restart()
    expectOnlyKept()

    // A list of every view replaces them all.
    mocks.getSubscriptions.mockResolvedValue({ code: 0, data: [] })
    await subscriptionSyncService.fetch()
    await restart()
    expect(useSubscriptionStore.getState().data).toEqual({})
  })
})

describe("getSortedGroupedSubscriptionSelector", () => {
  test("sorts folders by the unread total of their feeds and hides read ones", () => {
    useUnreadStore.setState({ data: { a: 1, b: 1, c: 5, d: 0 } })
    const grouped = { Two: ["a", "b"], Five: ["c"], Read: ["d"] }
    const select = getSortedGroupedSubscriptionSelector(useSubscriptionStore.getState())

    expect(
      select({
        view: FeedViewType.Articles,
        grouped,
        sortBy: "count",
        sortOrder: "desc",
        hideAllReadSubscriptions: true,
      }).map((group) => group.category),
    ).toEqual(["Five", "Two"])
  })
})
