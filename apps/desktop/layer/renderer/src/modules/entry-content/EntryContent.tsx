import { Spring } from "@follow/components/constants/spring.js"
import { RootPortal } from "@follow/components/ui/portal/index.js"
import { ScrollArea } from "@follow/components/ui/scroll-area/index.js"
import { FeedViewType } from "@follow/constants"
import { useTitle } from "@follow/hooks"
import { useEntry } from "@follow/store/entry/hooks"
import { thenable } from "@follow/utils"
import { stopPropagation } from "@follow/utils/dom"
import { EventBus } from "@follow/utils/event-bus"
import { cn } from "@follow/utils/utils"
import { useAnimationControls } from "motion/react"
import * as React from "react"
import { memo, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useEntryIsInReadability } from "~/atoms/readability"
import { AppErrorBoundary } from "~/components/common/AppErrorBoundary"
import { Focusable } from "~/components/common/Focusable"
import { m } from "~/components/common/Motion"
import { ErrorComponentType } from "~/components/errors/enum"
import { GlassButton } from "~/components/ui/button/GlassButton"
import { HotkeyScope } from "~/constants"
import { useEntryView } from "~/hooks/biz/useEntryView"
import { useFeedSafeUrl } from "~/hooks/common/useFeedSafeUrl"
import { COMMAND_ID } from "~/modules/command/commands/id"

import { setEntryContentScrollToTop } from "./atoms"
import { ApplyEntryActions } from "./components/ApplyEntryActions"
import { EntryCommandShortcutRegister } from "./components/entry-content/EntryCommandShortcutRegister"
import { EntryContentFallback } from "./components/entry-content/EntryContentFallback"
import { EntryContentPlaceholder } from "./components/entry-content/EntryContentPlaceholder"
import { EntryScrollingAndNavigationHandler } from "./components/entry-content/EntryScrollingAndNavigationHandler.js"
import { EntryTitleMetaHandler } from "./components/entry-content/EntryTitleMetaHandler"
import type { EntryContentProps } from "./components/entry-content/types"
import { EntryPrintHeader } from "./components/EntryPrintHeader"
import { getEntryContentLayout } from "./components/layouts"
import { SourceContentPanel } from "./components/SourceContentView"
import { useEntryContent } from "./hooks"

const contentVariants = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 30 },
}
const EntryContentImpl: Component<EntryContentProps> = ({
  entryId,
  noMedia,
  className,
  compact,
}) => {
  const { t } = useTranslation()
  // Undefined only while the entry is not in the store yet
  const title = useEntry(entryId, (state) => state.title)

  if (title === undefined) throw thenable

  useTitle(title)
  const isInReadabilityMode = useEntryIsInReadability(entryId)

  const { error, content, isPending } = useEntryContent(entryId)

  const view = useEntryView(entryId)
  const [scrollerRef, setScrollerRef] = useState<HTMLDivElement | null>(null)
  const safeUrl = useFeedSafeUrl(entryId)

  const [panelPortalElement, setPanelPortalElement] = useState<HTMLDivElement | null>(null)

  const isInHasTimelineView = ![
    FeedViewType.Pictures,
    FeedViewType.SocialMedia,
    FeedViewType.Videos,
  ].includes(view)

  const animationController = useAnimationControls()

  const focusableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    animationController.set(contentVariants.exit)
    animationController.start(contentVariants.animate)

    // Scroll to top
    if (scrollerRef) {
      scrollerRef.scrollTop = 0
    }
    focusableRef.current?.focus()
    return () => {
      animationController.stop()
    }
  }, [animationController, entryId, scrollerRef])

  useEffect(() => {
    setEntryContentScrollToTop(true)
  }, [entryId])
  useEffect(() => {
    if (!scrollerRef) return

    const handler = () => {
      setEntryContentScrollToTop(scrollerRef.scrollTop < 50)
    }
    scrollerRef.addEventListener("scroll", handler)

    return () => {
      scrollerRef.removeEventListener("scroll", handler)
    }
  }, [scrollerRef])

  const scrollerRefObject = React.useMemo(() => ({ current: scrollerRef }), [scrollerRef])
  return (
    <div className={cn(className, "flex flex-col @container")}>
      <EntryTitleMetaHandler entryId={entryId} />
      <EntryCommandShortcutRegister entryId={entryId} view={view} />

      <div className="w-full" ref={setPanelPortalElement} />

      <Focusable
        ref={focusableRef}
        scope={HotkeyScope.EntryRender}
        className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden @container print:size-auto print:overflow-visible"
      >
        <RootPortal to={panelPortalElement}>
          <EntryScrollingAndNavigationHandler entryId={entryId} scrollerRef={scrollerRefObject} />
        </RootPortal>

        <EntryScrollArea scrollerRef={setScrollerRef}>
          {/* Indicator for the entry */}
          {isInHasTimelineView && (
            <>
              <div className="absolute inset-y-0 left-0 z-[9] flex w-12 items-center justify-center opacity-0 duration-200 hover:opacity-100 group-hover:opacity-40">
                <GlassButton
                  size="sm"
                  description={t("command.entry.previous_entry.title", { ns: "shortcuts" })}
                  className="!-translate-y-12 !bg-material-opaque !opacity-100 hover:!bg-material-opaque"
                  onClick={() => {
                    EventBus.dispatch(COMMAND_ID.timeline.switchToPrevious)
                  }}
                >
                  <i className="i-mgc-left-small-sharp size-6" />
                </GlassButton>
              </div>

              <div className="absolute inset-y-0 right-0 z-[9] flex w-12 items-center justify-center opacity-0 duration-200 hover:opacity-100 group-hover:opacity-40">
                <GlassButton
                  size="sm"
                  description={t("command.entry.next_entry.title", { ns: "shortcuts" })}
                  className="!-translate-y-12 !bg-material-opaque !opacity-100 hover:!bg-material-opaque"
                  onClick={() => {
                    EventBus.dispatch(COMMAND_ID.timeline.switchToNext)
                  }}
                >
                  <i className="i-mgc-right-small-sharp size-6" />
                </GlassButton>
              </div>
            </>
          )}
          <m.div
            lcpOptimization
            className="select-text"
            initial={{ opacity: 0, y: 30 }}
            animate={animationController}
            transition={Spring.presets.smooth}
          >
            <article
              data-testid="entry-render"
              onContextMenu={stopPropagation}
              className={"relative w-full min-w-0 pb-10 pt-12 print:pt-0"}
            >
              <ApplyEntryActions entryId={entryId} view={view} key={entryId} />
              <EntryPrintHeader entryId={entryId} />

              {!content && !isInReadabilityMode && (isPending || error) ? (
                <EntryContentPlaceholder entryId={entryId} error={error} />
              ) : (
                <AdaptiveContentRenderer
                  // The state of a layout, such as an open transcript, belongs to one entry
                  key={entryId}
                  entryId={entryId}
                  view={view}
                  compact={compact}
                  noMedia={noMedia}
                />
              )}
            </article>
          </m.div>
        </EntryScrollArea>
        <SourceContentPanel src={safeUrl} />
      </Focusable>
    </div>
  )
}
export const EntryContent: Component<EntryContentProps> = memo((props) => {
  return (
    <AppErrorBoundary errorType={ErrorComponentType.EntryNotFound}>
      <EntryContentFallback entryId={props.entryId}>
        <EntryContentImpl {...props} />
      </EntryContentFallback>
    </AppErrorBoundary>
  )
})

const EntryScrollArea: Component<{
  scrollerRef: React.Ref<HTMLDivElement | null>
  viewportClassName?: string
}> = ({ children, className, scrollerRef, viewportClassName }) => {
  return (
    <ScrollArea.ScrollArea
      focusable
      mask={false}
      flex
      rootClassName={cn(
        "flex-1 min-h-0 relative z-[1] overflow-y-auto print:h-auto print:overflow-visible",
        className,
      )}
      scrollbarClassName="mr-[1.5px] print:hidden"
      ref={scrollerRef}
      viewportClassName={viewportClassName}
      scrollbarProps={{
        className: "mt-16 z-[999]",
      }}
    >
      {children}
    </ScrollArea.ScrollArea>
  )
}

const AdaptiveContentRenderer: React.FC<{
  entryId: string
  view: FeedViewType
  compact?: boolean
  noMedia?: boolean
}> = ({ entryId, view, compact = false, noMedia = false }) => {
  const LayoutComponent = getEntryContentLayout(view)

  return <LayoutComponent entryId={entryId} view={view} compact={compact} noMedia={noMedia} />
}
