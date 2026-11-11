import type { BizRouteParams } from "~/hooks/biz/useRouteParams"

import type { ValueContextBlock } from "./types"

export type RouteContextParams = Pick<
  BizRouteParams,
  "entryId" | "isPendingEntry" | "view" | "feedId" | "isAllFeeds" | "timelineId"
>

/** What the user is looking at: a message is about it unless the user leaves it out */
export interface RouteContext {
  /** Tells this context from those of other entries and timelines */
  key: string
  blocks: ValueContextBlock[]
}

/** The entry open in the timeline */
export const getOpenEntryId = (route: RouteContextParams) =>
  route.isPendingEntry ? undefined : route.entryId

/** The open entry, or else the timeline shown; nothing outside the timeline */
export const getRouteContext = (
  route: RouteContextParams,
  unreadOnly: boolean,
): RouteContext | null => {
  const entryId = getOpenEntryId(route)
  if (entryId) {
    return {
      key: `entry:${entryId}`,
      blocks: [{ id: "mainEntry", type: "mainEntry", value: entryId }],
    }
  }
  if (!route.timelineId) return null

  const feedId = route.isAllFeeds ? undefined : route.feedId
  const blocks: ValueContextBlock[] = [{ id: "mainView", type: "mainView", value: `${route.view}` }]
  if (feedId) blocks.push({ id: "mainFeed", type: "mainFeed", value: feedId })
  if (unreadOnly) blocks.push({ id: "unreadOnly", type: "unreadOnly", value: "true" })

  return { key: `timeline:${route.view}:${feedId ?? ""}`, blocks }
}
