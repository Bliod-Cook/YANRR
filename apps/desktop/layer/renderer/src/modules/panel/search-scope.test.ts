import { FeedViewType } from "@follow/constants"
import { useSubscriptionStore } from "@follow/store/subscription/store"
import type { SubscriptionModel } from "@follow/store/subscription/types"
import { beforeEach, describe, expect, it } from "vitest"

import { routeSearchScope, searchScopeParams } from "./search-scope"

const subscription = (feedId: string, category: string | null): SubscriptionModel => ({
  feedId,
  inboxId: null,
  userId: "user-1",
  view: FeedViewType.Articles,
  hideFromTimeline: null,
  title: null,
  category,
  createdAt: null,
  type: "feed",
})

const paramsOf = (route: Parameters<typeof routeSearchScope>[0]) => {
  const scope = routeSearchScope(route)
  return scope && searchScopeParams(scope)
}

describe("a search narrowed to the timeline on screen", () => {
  beforeEach(() => {
    useSubscriptionStore.setState({
      data: {
        rust: subscription("rust", "Dev"),
        go: subscription("go", "Dev"),
        news: subscription("news", null),
      },
    })
  })

  it("asks for what the timeline asks for", () => {
    const articles = FeedViewType.Articles
    expect(paramsOf({ view: articles, feedId: "rust" })).toEqual({ view: articles, feedId: "rust" })
    expect(paramsOf({ view: articles, feedId: "folder-Dev" })).toEqual({
      view: articles,
      feedIdList: ["rust", "go"],
    })
    expect(paramsOf({ view: articles, feedId: "inbox-mail", inboxId: "mail" })).toEqual({
      view: articles,
      inboxId: "mail",
    })
    expect(paramsOf({ view: articles, feedId: "collections" })).toEqual({
      view: articles,
      isCollection: true,
    })
    expect(paramsOf({ view: FeedViewType.SocialMedia, feedId: "all" })).toEqual({
      view: FeedViewType.SocialMedia,
    })
  })

  it("only expands a category named all on its folder route", () => {
    useSubscriptionStore.setState({ data: { rust: subscription("rust", "all") } })
    const view = FeedViewType.Articles
    expect(paramsOf({ view, feedId: "all" })).toEqual({ view })
    expect(paramsOf({ view, feedId: "folder-all" })).toEqual({ view, feedId: "rust" })
  })

  it("is a plain search on the All view with nothing picked", () => {
    expect(routeSearchScope({ view: FeedViewType.All })).toBeNull()
    expect(routeSearchScope({ view: FeedViewType.All, feedId: "all" })).toBeNull()
    expect(routeSearchScope({ view: FeedViewType.All, feedId: "rust" })).toEqual({
      view: FeedViewType.All,
      feedId: "rust",
    })
  })
})
