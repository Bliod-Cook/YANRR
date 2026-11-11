import type { FeedViewType } from "@follow/constants"
import { memo } from "react"

import { useEntries } from "@/src/modules/screen/atoms"
import { PagerList } from "@/src/modules/screen/PagerList"
import { TimelineHeader } from "@/src/modules/screen/TimelineSelectorProvider"

import { EntryListSelector } from "./EntryListSelector"

// Keep each column's list mounted so its native scroll position survives view switches.
const renderViewItem = (view: FeedViewType, active: boolean) => (
  <ViewEntryList key={view} viewId={view} active={active} />
)

/** Home: a list of entries for each view */
export function EntryList() {
  return (
    <>
      <TimelineHeader />
      <PagerList renderItem={renderViewItem} />
    </>
  )
}

const ViewEntryList = memo(({ viewId, active }: { viewId: FeedViewType; active: boolean }) => {
  const entries = useEntries({ viewId, active })
  return <EntryListSelector entries={entries} viewId={viewId} active={active} />
})
