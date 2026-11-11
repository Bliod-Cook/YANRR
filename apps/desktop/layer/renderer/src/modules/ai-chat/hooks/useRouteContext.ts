import { useMemo } from "react"

import { useGeneralSettingKey } from "~/atoms/settings/general"
import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"

import type { RouteContextParams } from "../store/route-context"
import { getRouteContext } from "../store/route-context"

const selectRouteContextParams = ({
  entryId,
  isPendingEntry,
  view,
  feedId,
  isAllFeeds,
  timelineId,
}: RouteContextParams): RouteContextParams => ({
  entryId,
  isPendingEntry,
  view,
  feedId,
  isAllFeeds,
  timelineId,
})

/** What the next message is about, as `getRouteContext` describes it */
export const useRouteContext = () => {
  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const route = useRouteParamsSelector(selectRouteContextParams)
  return useMemo(() => getRouteContext(route, unreadOnly), [route, unreadOnly])
}
