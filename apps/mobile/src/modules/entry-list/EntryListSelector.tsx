import { FeedViewType } from "@follow/constants"
import { useWhoami } from "@follow/store/user/hooks"
import type { FlashListRef } from "@shopify/flash-list"
import type { FC, RefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"

import { useEffectiveEntrySortOrder, useGeneralSettingKey } from "@/src/atoms/settings/general"
import { withErrorBoundary } from "@/src/components/common/ErrorBoundary"
import { NoLoginInfo } from "@/src/components/common/NoLoginInfo"
import { ListErrorView } from "@/src/components/errors/ListErrorView"
import { useRegisterNavigationScrollView } from "@/src/components/layouts/tabbar/hooks"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { EntryListContentPicture } from "@/src/modules/entry-list/EntryListContentPicture"
import { EntryDetailScreen } from "@/src/screens/(stack)/entries/[entryId]/EntryDetailScreen"

import { useEntryListContext, useIsTimelineEntrySource } from "../screen/atoms"
import type { TimelineEntries } from "../screen/timeline-entries"
import { EntryListContentArticle } from "./EntryListContentArticle"
import { EntryListContentSocial } from "./EntryListContentSocial"
import { EntryListContentVideo } from "./EntryListContentVideo"
import type { EntryListContentProps } from "./types"

const NoLoginGuard = ({ children }: { children: React.ReactNode }) => {
  const whoami = useWhoami()
  const screenType = useEntryListContext().type

  if (whoami || screenType !== "subscriptions") {
    return children
  }

  return <NoLoginInfo target="subscriptions" />
}

type EntryListSelectorProps = {
  entries: TimelineEntries
  viewId: FeedViewType
  active?: boolean
}

function EntryListSelectorImpl({ entries, viewId, active = true }: EntryListSelectorProps) {
  const { entriesIds: entryIds, isReady } = entries
  const ref = useRegisterNavigationScrollView<FlashListRef<any>>(active)
  const [resetScrollSignal, setResetScrollSignal] = useState<number>()
  const [appliedResetScrollSignal, setAppliedResetScrollSignal] = useState<number>()
  // Until the list is back at its top, what it reports visible belongs to the place it leaves
  const isScrollResetPending =
    resetScrollSignal !== undefined && resetScrollSignal !== appliedResetScrollSignal
  const requestScrollToTop = useCallback(() => {
    setResetScrollSignal((signal) => (signal ?? 0) + 1)
  }, [])
  const handleResetScrollSignalConsumed = useCallback((signal: number) => {
    setAppliedResetScrollSignal((currentSignal) =>
      currentSignal === signal ? currentSignal : signal,
    )
  }, [])

  let ContentComponent: FC<EntryListContentProps> = EntryListContentArticle
  switch (viewId) {
    case FeedViewType.SocialMedia: {
      ContentComponent = EntryListContentSocial
      break
    }
    case FeedViewType.Pictures: {
      ContentComponent = EntryListContentPicture
      break
    }
    case FeedViewType.Videos: {
      ContentComponent = EntryListContentVideo
      break
    }
    case FeedViewType.Articles: {
      ContentComponent = EntryListContentArticle
      break
    }
  }

  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const isTimelineSource = useIsTimelineEntrySource()
  const sortOrder = useEffectiveEntrySortOrder({ isTimelineSource })
  useEffect(() => {
    requestScrollToTop()
  }, [requestScrollToTop, sortOrder, unreadOnly])

  const hasResetAfterReadyRef = useRef(false)
  useEffect(() => {
    if (!active) return
    if (!isReady) {
      hasResetAfterReadyRef.current = false
      return
    }
    if (!entryIds?.length) return
    if (hasResetAfterReadyRef.current) return

    requestScrollToTop()
    hasResetAfterReadyRef.current = true
  }, [active, entryIds, isReady, requestScrollToTop, viewId])

  useAutoScrollToEntryAfterPullUpToNext(ref, entryIds || [])

  return (
    <ContentComponent
      ref={ref}
      entries={entries}
      active={active}
      view={viewId}
      onResetScrollSignalConsumed={handleResetScrollSignalConsumed}
      resetScrollSignal={resetScrollSignal}
      suspendMarkRead={isScrollResetPending}
    />
  )
}

export const EntryListSelector = withErrorBoundary(
  ({ entries, viewId, active }: EntryListSelectorProps) => {
    return (
      <NoLoginGuard>
        <EntryListSelectorImpl entries={entries} viewId={viewId} active={active} />
      </NoLoginGuard>
    )
  },
  ListErrorView,
)

const useAutoScrollToEntryAfterPullUpToNext = (
  ref: RefObject<FlashListRef<any> | null>,
  entryIds: string[],
) => {
  const navigation = useNavigation()
  useEffect(() => {
    return navigation.on("screenChange", (payload) => {
      if (!payload.route) return
      if (payload.type !== "appear") return
      if (payload.route.Component !== EntryDetailScreen) return
      if (payload.route.screenOptions?.stackAnimation !== "fade_from_bottom") return
      const nextEntryId =
        payload.route.props &&
        typeof payload.route.props === "object" &&
        "entryId" in payload.route.props &&
        typeof payload.route.props.entryId === "string"
          ? payload.route.props.entryId
          : undefined
      const idx = nextEntryId ? (entryIds?.indexOf(nextEntryId || "") ?? -1) : -1
      if (idx === -1) return
      ref?.current?.scrollToIndex({
        index: idx,
        animated: false,
        viewOffset: 70,
      })
    })
  }, [entryIds, navigation, ref])
}
