import { FeedViewType } from "@follow/constants"
import type { EntrySearchScope } from "@follow/store/entry/store"
import { getEntriesParams } from "@follow/store/entry/utils"
import { getCategoryFeedIds } from "@follow/store/subscription/getter"

import { ROUTE_FEED_PENDING } from "~/constants"
import type { BizRouteParams } from "~/hooks/biz/useRouteParams"

/** A timeline a search is narrowed to, as the route names it; `feedId` is `all` for a whole view */
export interface SearchScope {
  view: FeedViewType
  feedId: string
  inboxId?: string
}

/** The timeline on screen, or `null` on the All view with nothing picked, where a plain search is meant */
export const routeSearchScope = ({
  view,
  feedId = ROUTE_FEED_PENDING,
  inboxId,
}: Pick<BizRouteParams, "view" | "feedId" | "inboxId">): SearchScope | null =>
  view === FeedViewType.All && feedId === ROUTE_FEED_PENDING ? null : { view, feedId, inboxId }

/** What the server takes for the timeline of `scope`, asked for as the timeline asks for it */
export const searchScopeParams = ({ view, feedId, inboxId }: SearchScope): EntrySearchScope => {
  const folder = getCategoryFeedIds(feedId, view)
  const params = getEntriesParams({ feedId: folder.join(",") || feedId, inboxId, view })
  return {
    view: params.view,
    feedId: params.feedId,
    feedIdList: params.feedIdList,
    inboxId: params.inboxId,
    isCollection: params.isCollection,
  }
}
