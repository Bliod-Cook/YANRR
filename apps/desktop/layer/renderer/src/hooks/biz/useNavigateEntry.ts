import { getReadonlyRoute, getStableRouterNavigate } from "@follow/components/atoms/route.js"
import type { FeedViewType } from "@follow/constants"
import { getEntry } from "@follow/store/entry/getter"
import { getSubscriptionByFeedId } from "@follow/store/subscription/getter"
import { useCallback } from "react"
import { toast } from "sonner"

import { disableShowAISummaryOnce } from "~/atoms/ai-summary"
import { disableShowAITranslationOnce } from "~/atoms/ai-translation"
import { resetShowSourceContent } from "~/atoms/source-content"
import {
  ROUTE_ENTRY_PENDING,
  ROUTE_FEED_IN_FOLDER,
  ROUTE_FEED_IN_INBOX,
  ROUTE_FEED_PENDING,
} from "~/constants"

import { getTimelineIdByView, useRouteParamsSelector } from "./useRouteParams"

export type NavigateEntryOptions = Partial<{
  timelineId: string
  feedId: string | null
  entryId: string | null
  view: FeedViewType
  folderName: string | null
  inboxId: string
  /** Opens the feed as a preview, whose back button returns to this path */
  backPath: string
}>

type PreviewLocationState = { previewBackPath?: string }

/**
 * Where the back button of the feed preview on screen, and following the feed from it, return to.
 * It lives in the history entry, so it is gone once another feed is opened.
 */
export const getPreviewBackPath = () =>
  (getReadonlyRoute().location.state as PreviewLocationState | null)?.previewBackPath

/**
 * @description a hook to navigate to `feedId`, `entryId`, add search for `view`, `level`
 */
export const useNavigateEntry = () => {
  return useCallback((options: NavigateEntryOptions) => navigateEntry(options), [])
}

type ParsedNavigateEntryOptions = {
  feedId: string
  timelineId: string
  entryId: string
}

const parseNavigateEntryOptions = (options: NavigateEntryOptions): ParsedNavigateEntryOptions => {
  const { entryId, feedId, view, folderName, inboxId, timelineId } = options || {}
  const route = getReadonlyRoute()
  const { params } = route
  let finalFeedId = feedId || params.feedId || ROUTE_FEED_PENDING
  let finalTimelineId = timelineId || params.timelineId || ROUTE_FEED_PENDING
  const finalEntryId = entryId || ROUTE_ENTRY_PENDING
  const subscription = getSubscriptionByFeedId(finalFeedId)
  const finalView = typeof view === "number" ? view : subscription?.view

  if ("feedId" in options && feedId === null) {
    finalFeedId = ROUTE_FEED_PENDING
  }

  if (folderName) {
    finalFeedId = `${ROUTE_FEED_IN_FOLDER}${folderName}`
  }

  if (inboxId) {
    finalFeedId = `${ROUTE_FEED_IN_INBOX}${inboxId}`
  }

  finalFeedId = encodeURIComponent(finalFeedId)

  if (finalView !== undefined && !timelineId) {
    finalTimelineId = getTimelineIdByView(finalView)
  }

  return {
    feedId: finalFeedId,
    timelineId: finalTimelineId,
    entryId: finalEntryId,
  }
}

export function getNavigateEntryPath(options: NavigateEntryOptions | ParsedNavigateEntryOptions) {
  if ("feedId" in options) {
    return `/timeline/${options.timelineId}/${options.feedId}/${options.entryId}`
  }

  const { feedId, timelineId, entryId } = parseNavigateEntryOptions(options)

  return `/timeline/${timelineId}/${feedId}/${entryId}`
}

/*
 * /timeline/:timelineId/:feedId/:entryId
 * timelineId: articles | social-media | view-1 (legacy) | ...
 * feedId: xxx, folder-xxx, inbox-xxx
 * entryId: xxx
 */
export const navigateEntry = (options: NavigateEntryOptions) => {
  const parsedOptions = parseNavigateEntryOptions(options)
  const path = getNavigateEntryPath(parsedOptions)
  const { backPath } = options || {}
  const route = getReadonlyRoute()
  const currentPath = route.location.pathname + route.location.search
  if (path === currentPath) return

  // Entries opened in a preview keep its way back
  const staysInFeed = parsedOptions.feedId === encodeURIComponent(route.params.feedId ?? "")
  const previewBackPath = backPath ?? (staysInFeed ? getPreviewBackPath() : undefined)

  disableShowAISummaryOnce()
  disableShowAITranslationOnce()
  const sourceContent = getEntry(parsedOptions.entryId)?.settings?.sourceContent
  if (!sourceContent) {
    resetShowSourceContent()
  }

  const navigate = getStableRouterNavigate()

  if (!navigate) {
    const message =
      "Navigation is not available, maybe a mistake in the code, please report an issue. thx."
    toast.error(message)
    throw new Error(message, { cause: "Navigation is not available" })
  }

  const state: PreviewLocationState | undefined = previewBackPath ? { previewBackPath } : undefined
  return navigate(path, { state })
}

export const useBackHome = (timelineId?: string) => {
  const navigate = useNavigateEntry()
  const feedId = useRouteParamsSelector((state) => state.feedId)
  const entryId = useRouteParamsSelector((state) => state.entryId)
  const backToFeed =
    entryId && feedId && entryId !== ROUTE_ENTRY_PENDING && feedId !== ROUTE_FEED_PENDING
  const feedIdToNavigate = backToFeed ? feedId : null

  return useCallback(
    (overvideTimelineId?: string) => {
      navigate({
        feedId: feedIdToNavigate,
        entryId: null,
        timelineId: overvideTimelineId ?? timelineId,
      })
    },
    [navigate, feedIdToNavigate, timelineId],
  )
}
