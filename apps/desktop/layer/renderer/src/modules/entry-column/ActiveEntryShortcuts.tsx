import { useGlobalFocusableScopeSelector } from "@follow/components/common/Focusable/hooks.js"
import type { FeedViewType } from "@follow/constants"

import { FocusablePresets } from "~/components/common/Focusable"
import { useContextMenuActionShortCutTrigger } from "~/hooks/biz/useContextMenuActionShortCutTrigger"
import { useEntryActions } from "~/hooks/biz/useEntryActions"
import { useRouteParams } from "~/hooks/biz/useRouteParams"

/** Registers the shortcuts of the open entry's actions, once for the timeline instead of per row. */
export const ActiveEntryShortcuts = () => {
  const { entryId, view } = useRouteParams()
  if (!entryId) return null
  return <Shortcuts entryId={entryId} view={view} />
}

const Shortcuts = ({ entryId, view }: { entryId: string; view: FeedViewType }) => {
  const actions = useEntryActions({ entryId, view })
  const when = useGlobalFocusableScopeSelector(FocusablePresets.isTimeline)
  useContextMenuActionShortCutTrigger(actions, when)
  return null
}
