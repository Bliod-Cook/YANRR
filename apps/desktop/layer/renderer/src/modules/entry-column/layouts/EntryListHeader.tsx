import { ActionButton, MotionButtonBase } from "@follow/components/ui/button/index.js"
import { DividerVertical } from "@follow/components/ui/divider/index.js"
import { RotatingRefreshIcon } from "@follow/components/ui/loading/index.jsx"
import { EllipsisHorizontalTextWithTooltip } from "@follow/components/ui/typography/index.js"
import { FeedViewType, getView } from "@follow/constants"
import { useIsOnline } from "@follow/hooks"
import { getFeedById } from "@follow/store/feed/getter"
import { useFeedById } from "@follow/store/feed/hooks"
import { useIsLoggedIn } from "@follow/store/user/hooks"
import { stopPropagation } from "@follow/utils/dom"
import { clsx, cn, isBizId } from "@follow/utils/utils"
import { useAtom, useAtomValue } from "jotai"
import type { FC } from "react"
import { lazy, Suspense, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { setGeneralSetting, useGeneralSettingKey } from "~/atoms/settings/general"
import { useSubscriptionColumnShow } from "~/atoms/sidebar"
import { ROUTE_ENTRY_PENDING } from "~/constants"
import { useFeature } from "~/hooks/biz/useFeature"
import { useFollow } from "~/hooks/biz/useFollow"
import { getPreviewBackPath } from "~/hooks/biz/useNavigateEntry"
import { getRouteParams, useRouteParams } from "~/hooks/biz/useRouteParams"
import { useLoginModal } from "~/hooks/common"
import { COMMAND_ID } from "~/modules/command/commands/id"
import { useRunCommandFn } from "~/modules/command/hooks/use-command"
import { useCommandShortcut } from "~/modules/command/hooks/use-command-binding"
import { EntryHeader } from "~/modules/entry-content/components/entry-header"
import { FeedIcon } from "~/modules/feed/feed-icon"
import { useRefreshFeedMutation } from "~/queries/feed"
import { useFeedHeaderIcon, useFeedHeaderTitle } from "~/store/feed/hooks"

import { aiTimelineEnabledAtom } from "../atoms/ai-timeline"
import { MarkAllReadButton } from "../components/mark-all-button"
import {
  getEffectiveRouteEntrySortOrder,
  isTimelineEntrySortScope,
} from "../hooks/entry-sort-order"
import { useIsPreviewFeed } from "../hooks/useIsPreviewFeed"
import { useEntryRootState } from "../store/EntryColumnContext"
import { AppendTaildingDivider } from "./AppendTaildingDivider"
import { SwitchToMasonryButton } from "./buttons/SwitchToMasonryButton"

const TimelineSummaryButton = lazy(() =>
  import("./TimelineSummaryButton").then((m) => ({ default: m.TimelineSummaryButton })),
)

export const EntryListHeader: FC<{
  refetch: () => void
  isRefreshing: boolean
  onBeforeRefresh?: () => void
}> = ({ refetch, isRefreshing, onBeforeRefresh }) => {
  const routerParams = useRouteParams()
  const { t } = useTranslation()

  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const savedSortOrder = useGeneralSettingKey("timelineSortOrder")
  const [aiTimelineEnabled, setAiTimelineEnabled] = useAtom(aiTimelineEnabledAtom)
  const aiEnabled = useFeature("ai")

  const { feedId, entryId, view, inboxId, isCollection } = routerParams
  const isPreview = useIsPreviewFeed()
  const isTimelineSource = isTimelineEntrySortScope({
    feedId,
    inboxId,
    isCollection,
    isPreview,
  })
  const effectiveSortOrder = getEffectiveRouteEntrySortOrder({
    sortOrder: savedSortOrder,
    unreadOnly,
    feedId,
    inboxId,
    isCollection,
    isPreview,
  })
  const effectiveAiTimelineEnabled = aiTimelineEnabled && effectiveSortOrder === "desc"
  const showSortOrderButton = unreadOnly && isTimelineSource
  const isWideMode = !!getView(view)?.wideMode

  const headerTitle = useFeedHeaderTitle()
  const feedIcon = useFeedHeaderIcon()

  const titleInfo = !!headerTitle && (
    <div
      className={clsx(
        "flex min-w-0 items-center break-all text-lg font-bold leading-tight",
        "-ml-3",
      )}
    >
      {feedIcon && <FeedIcon target={feedIcon} fallback size={20} className="mr-4" />}
      <EllipsisHorizontalTextWithTooltip className="inline-block !w-auto max-w-full">
        {headerTitle}
      </EllipsisHorizontalTextWithTooltip>
    </div>
  )
  const { mutate: refreshFeed, isPending } = useRefreshFeedMutation(feedId)

  const isOnline = useIsOnline()

  const feed = useFeedById(feedId)

  const feedColumnShow = useSubscriptionColumnShow()
  const toggleUnreadOnlyShortcut = useCommandShortcut(COMMAND_ID.timeline.unreadOnly)
  const runCmdFn = useRunCommandFn()

  const { isScrolledBeyondThreshold } = useEntryRootState()
  const isScrolledBeyondThresholdValue = useAtomValue(isScrolledBeyondThreshold)
  const showEntryHeader = isWideMode && !!entryId && entryId !== ROUTE_ENTRY_PENDING
  const showTimelineSummaryButton = isWideMode && aiEnabled
  const showAiTimelineToggle = aiEnabled

  const handleAiTimelineButtonClick = useCallback(() => {
    if (!effectiveAiTimelineEnabled) {
      if (effectiveSortOrder === "asc") {
        onBeforeRefresh?.()
        setGeneralSetting("timelineSortOrder", "desc")
      }
      setAiTimelineEnabled(true)
      return
    }
    setAiTimelineEnabled(false)
  }, [effectiveAiTimelineEnabled, effectiveSortOrder, onBeforeRefresh, setAiTimelineEnabled])

  const handleSortOrderButtonClick = useCallback(() => {
    onBeforeRefresh?.()
    const nextSortOrder = effectiveSortOrder === "desc" ? "asc" : "desc"
    setGeneralSetting("timelineSortOrder", nextSortOrder)
    if (nextSortOrder === "asc" && aiTimelineEnabled) {
      setAiTimelineEnabled(false)
    }
  }, [aiTimelineEnabled, effectiveSortOrder, onBeforeRefresh, setAiTimelineEnabled])

  const renderAiTimelineButton = () => {
    if (!showAiTimelineToggle) return null
    return (
      <ActionButton
        tooltip={t("entry_list_header.ai_timeline")}
        active={effectiveAiTimelineEnabled}
        onClick={handleAiTimelineButtonClick}
      >
        {effectiveAiTimelineEnabled ? (
          <i className="i-mgc-refresh-4-ai-cute-re text-purple-600 dark:text-purple-400" />
        ) : (
          <i className="i-mgc-refresh-4-ai-cute-re text-purple-600 dark:text-purple-400" />
        )}
      </ActionButton>
    )
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col pl-7 pr-2.5 pt-2 @[700px]:pr-3 @[1024px]:pr-4",
        !feedColumnShow && "macos:mt-4 macos:pt-margin-macos-traffic-light-y",
        view === FeedViewType.SocialMedia && "pr-5",
        isPreview
          ? "h-top-header-in-preview-with-border-b px-2.5 @[700px]:px-3 @[1024px]:px-4"
          : "h-top-header-with-border-b",
        view === FeedViewType.All &&
          "border-b border-transparent data-[scrolled-beyond-threshold=true]:border-b-border",
      )}
      data-scrolled-beyond-threshold={isScrolledBeyondThresholdValue}
    >
      <div className={"flex w-full justify-between"}>
        {isPreview ? <PreviewHeaderInfoWrapper>{titleInfo}</PreviewHeaderInfoWrapper> : titleInfo}
        {!isPreview && (
          <div
            className={cn(
              "relative z-[1] flex items-center gap-2 self-baseline text-text-secondary",
              !headerTitle && "opacity-0 [&_*]:!pointer-events-none",

              "translate-x-[6px]",
            )}
            onClick={stopPropagation}
          >
            {isWideMode &&
              (showEntryHeader || showTimelineSummaryButton || showAiTimelineToggle) && (
                <>
                  {showEntryHeader && <EntryHeader entryId={entryId} />}
                  {(showAiTimelineToggle || showTimelineSummaryButton) && (
                    <div className="flex items-center gap-2">
                      {aiTimelineEnabled && renderAiTimelineButton()}
                      {showTimelineSummaryButton && (
                        <Suspense>
                          <TimelineSummaryButton />
                        </Suspense>
                      )}
                    </div>
                  )}
                  <DividerVertical className="mx-2 w-px" />
                </>
              )}

            {!isWideMode && aiTimelineEnabled && renderAiTimelineButton()}

            <AppendTaildingDivider>
              {view === FeedViewType.Pictures && <SwitchToMasonryButton />}
            </AppendTaildingDivider>

            {isOnline &&
              (isBizId(routerParams.feedId!) && feed?.type === "feed" ? (
                <ActionButton
                  tooltip={t("entry_list_header.refresh")}
                  // The list is loaded again once the server has fetched the feed
                  onClick={() => refreshFeed(undefined, { onSuccess: () => refetch() })}
                >
                  <RotatingRefreshIcon isRefreshing={isPending || isRefreshing} />
                </ActionButton>
              ) : (
                <ActionButton
                  tooltip={t("entry_list_header.refetch")}
                  onClick={() => {
                    refetch()
                  }}
                >
                  <RotatingRefreshIcon isRefreshing={isRefreshing} />
                </ActionButton>
              ))}
            {showSortOrderButton && (
              <ActionButton
                tooltip={
                  effectiveSortOrder === "desc"
                    ? t("entry_list_header.sort_oldest_first")
                    : t("entry_list_header.sort_newest_first")
                }
                onClick={handleSortOrderButtonClick}
              >
                <i
                  className={
                    effectiveSortOrder === "desc"
                      ? "i-mgc-sort-descending-cute-re"
                      : "i-mgc-sort-ascending-cute-re"
                  }
                />
              </ActionButton>
            )}
            {!isCollection && (
              <>
                <ActionButton
                  tooltip={
                    !unreadOnly
                      ? t("entry_list_header.show_unread_only")
                      : t("entry_list_header.show_all")
                  }
                  shortcut={toggleUnreadOnlyShortcut}
                  onClick={() => {
                    onBeforeRefresh?.()
                    runCmdFn(COMMAND_ID.timeline.unreadOnly, [!unreadOnly])()
                  }}
                >
                  {unreadOnly ? (
                    <i className="i-mgc-round-cute-fi" />
                  ) : (
                    <i className="i-mgc-round-cute-re" />
                  )}
                </ActionButton>
                <MarkAllReadButton shortcut />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const PreviewHeaderInfoWrapper: Component = ({ children }) => {
  const { t: tCommon } = useTranslation("common")
  const follow = useFollow()

  const navigate = useNavigate()
  const isLoggedIn = useIsLoggedIn()
  const presentLoginModal = useLoginModal()

  return (
    <div className="flex w-full flex-col pt-1.5">
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
        <MotionButtonBase
          onClick={(e) => {
            e.stopPropagation()
            navigate(getPreviewBackPath() || "/")
          }}
          className="no-drag-region mr-1 inline-flex items-center gap-1 whitespace-nowrap duration-200 hover:text-accent"
        >
          <i className="i-mingcute-left-line" />
          <span className="text-sm font-medium">{tCommon("words.back")}</span>
        </MotionButtonBase>
        {children}
        <div />
      </div>

      <button
        type="button"
        className="-mx-4 mt-3.5 flex animate-gradient-x cursor-button place-items-center justify-center gap-1 bg-gradient-to-r from-accent/10 via-accent/15 to-accent/20 px-3 py-2 font-semibold text-accent transition-all duration-300 hover:bg-accent hover:text-white"
        onClick={() => {
          if (!isLoggedIn) {
            presentLoginModal()
            return
          }
          const { feedId } = getRouteParams()
          const feed = getFeedById(feedId)
          follow({
            id: feedId,
            url: feed?.type === "feed" ? feed.url : undefined,
          })
        }}
      >
        <i className="i-mgc-add-cute-fi size-4" />
        {tCommon("words.follow")}
      </button>
    </div>
  )
}
