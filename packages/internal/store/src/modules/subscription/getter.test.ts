import { FeedViewType } from "@follow/constants"
import { describe, expect, it } from "vitest"

import { useInboxStore } from "../inbox/store"
import {
  getSubscribedFeedIdAndInboxHandlesByView,
  getSubscriptionIdsByViewSelector,
} from "./getter"
import { useSubscriptionStore } from "./store"

describe("the subscriptions of a view", () => {
  it("include the inboxes in All, whose timeline and list show them as Articles do", () => {
    useSubscriptionStore.setState((state) => ({
      ...state,
      feedIdByView: {
        ...state.feedIdByView,
        [FeedViewType.All]: new Set(["feed-1", "picture-feed"]),
        [FeedViewType.Articles]: new Set(["feed-1"]),
        [FeedViewType.Pictures]: new Set(["picture-feed"]),
      },
    }))
    useInboxStore.setState({
      inboxes: { "inbox-1": { id: "inbox-1", title: "Inbox", secret: "", type: "inbox" } },
    })
    const idsOf = (view: FeedViewType) => ({
      counted: getSubscriptionIdsByViewSelector(useSubscriptionStore.getState())(view),
      markedRead: getSubscribedFeedIdAndInboxHandlesByView({ view, excludeHidden: true }),
    })

    expect(idsOf(FeedViewType.All)).toEqual({
      counted: ["feed-1", "picture-feed", "inbox-1"],
      markedRead: ["feed-1", "picture-feed", "inbox-1"],
    })
    expect(idsOf(FeedViewType.Articles)).toEqual({
      counted: ["feed-1", "inbox-1"],
      markedRead: ["feed-1", "inbox-1"],
    })
    expect(idsOf(FeedViewType.Pictures)).toEqual({
      counted: ["picture-feed"],
      markedRead: ["picture-feed"],
    })
  })
})
