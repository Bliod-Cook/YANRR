import { useGlobalFocusableScopeSelector } from "@follow/components/common/Focusable/hooks.js"
import { useSubscriptionByFeedId } from "@follow/store/subscription/hooks"

import { FocusablePresets } from "~/components/common/Focusable"
import { useContextMenuActionShortCutTrigger } from "~/hooks/biz/useContextMenuActionShortCutTrigger"
import { useFeedActions, useInboxActions } from "~/hooks/biz/useFeedActions"
import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"

import { useSelectedFeedIdsSelector } from "./atom"

/** Registers the shortcuts of the open feed or inbox, once for the column instead of per row. */
export const ActiveSubscriptionShortcuts = () => {
  const feedId = useRouteParamsSelector((s) => s.feedId)
  const inboxId = useRouteParamsSelector((s) => s.inboxId)
  if (inboxId) return <InboxShortcuts inboxId={inboxId} />
  if (feedId) return <FeedShortcuts feedId={feedId} />
  return null
}

const FeedShortcuts = ({ feedId }: { feedId: string }) => {
  const routeView = useRouteParamsSelector((s) => s.view)
  const subscription = useSubscriptionByFeedId(feedId)
  const feedIds = useSelectedFeedIdsSelector(
    (ids) => (ids.length > 1 && ids.includes(feedId) ? ids : undefined),
    [feedId],
  )
  const items = useFeedActions({ feedId, feedIds, view: subscription?.view ?? routeView })
  const when = useGlobalFocusableScopeSelector(FocusablePresets.isSubscriptionList)
  useContextMenuActionShortCutTrigger(items, when)
  return null
}

const InboxShortcuts = ({ inboxId }: { inboxId: string }) => {
  const { items } = useInboxActions({ inboxId })
  const when = useGlobalFocusableScopeSelector(FocusablePresets.isSubscriptionList)
  useContextMenuActionShortCutTrigger(items, when)
  return null
}
