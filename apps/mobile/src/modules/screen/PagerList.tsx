import type { FeedViewType } from "@follow/constants"
import { useViewWithSubscription } from "@follow/store/subscription/hooks"
import { EventBus } from "@follow/utils/event-bus"
import * as Haptics from "expo-haptics"
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react"
import type { StyleProp, ViewStyle } from "react-native"
import { StyleSheet, View } from "react-native"
import type {
  PagerViewOnPageScrollEventData,
  PagerViewOnPageSelectedEventData,
  PageScrollStateChangedNativeEventData,
} from "react-native-pager-view"
import PagerView from "react-native-pager-view"
import Animated, { runOnJS, useEvent, useHandler, useSharedValue } from "react-native-reanimated"

import { useTabScreenIsFocused } from "@/src/lib/navigation/bottom-tab/hooks"

import { selectTimeline, useSelectedFeed, useTimelineSelectorDragProgress } from "./atoms"
import { PagerListVisibleContext, PagerListWillVisibleContext } from "./PagerListContext"

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView)

const handlePageSelected = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
}

export function PagerList({
  renderItem,
  style,
}: {
  renderItem: (view: FeedViewType, active: boolean) => React.ReactNode
  style?: StyleProp<ViewStyle> | undefined
}) {
  const selectedFeed = useSelectedFeed()
  const viewId = selectedFeed.type === "view" ? selectedFeed.viewId : undefined

  const activeViews = useViewWithSubscription()

  const activeViewIndex = useMemo(
    () => activeViews.indexOf(viewId as FeedViewType),
    [activeViews, viewId],
  )
  const dragProgress = useTimelineSelectorDragProgress()

  const pagerRef = useRef<PagerView>(null)
  const layoutReadyRef = useRef(false)
  const isFocused = useTabScreenIsFocused()
  const isFocusedRef = useRef(isFocused)
  const activeViewIndexRef = useRef(activeViewIndex)
  const focused = useSharedValue(isFocused)
  const swiping = useSharedValue(false)

  useLayoutEffect(() => {
    activeViewIndexRef.current = activeViewIndex
  }, [activeViewIndex])

  useLayoutEffect(() => {
    isFocusedRef.current = isFocused
    focused.set(isFocused)
    if (!isFocused) {
      swiping.set(false)
      return
    }
    const index = activeViewIndexRef.current
    if (layoutReadyRef.current && index >= 0) {
      dragProgress.set(index)
      pagerRef.current?.setPageWithoutAnimation(index)
    }
  }, [dragProgress, focused, isFocused, swiping])

  const rid = useId()
  useEffect(() => {
    if (!isFocused) return
    return EventBus.subscribe("SELECT_TIMELINE", (data) => {
      if (data.target !== rid && layoutReadyRef.current) {
        const index = activeViews.indexOf(data.view.viewId)
        if (index < 0) return
        swiping.set(false)
        pagerRef.current?.setPage(index)
      }
    })
  }, [activeViews, isFocused, rid, swiping])

  const onPageSelectedJS = useCallback(
    (view: FeedViewType) => {
      if (isFocusedRef.current) {
        selectTimeline({ type: "view", viewId: view }, rid)
      }
    },
    [rid],
  )

  const handlePageScroll = usePagerHandlers(
    {
      onPageScroll(e: PagerViewOnPageScrollEventData) {
        "worklet"
        if (!focused.get()) return
        const { position, offset } = e
        dragProgress.set(offset + position)
      },
      onPageSelected(e: PagerViewOnPageSelectedEventData) {
        "worklet"
        if (!focused.get()) return
        if (swiping.get()) {
          swiping.set(false)
          dragProgress.set(e.position)
          const view = activeViews[e.position]
          if (view !== undefined) runOnJS(onPageSelectedJS)(view)
        } else if (e.position === activeViewIndex) {
          dragProgress.set(e.position)
        }
      },
      onPageScrollStateChanged(e: PageScrollStateChangedNativeEventData) {
        "worklet"
        if (!focused.get()) return
        if (e.pageScrollState === "dragging") {
          // Idle can arrive before the settled page, so only selection ends the swipe.
          swiping.set(true)
        }
      },
    },
    [activeViewIndex, activeViews, dragProgress, focused, onPageSelectedJS, swiping],
  )

  return (
    <AnimatedPagerView
      testID="pager-view"
      ref={pagerRef}
      style={[styles.PagerView, style]}
      initialPage={activeViewIndex}
      onLayout={({ nativeEvent: { layout } }) => {
        layoutReadyRef.current = layout.width > 0 && layout.height > 0
        if (!isFocusedRef.current || !layoutReadyRef.current || activeViewIndex < 0) return
        // Hidden tabs have no size; Compose cannot animate them. Sync once the page has a layout.
        swiping.set(false)
        dragProgress.set(activeViewIndex)
        pagerRef.current?.setPageWithoutAnimation(activeViewIndex)
      }}
      layoutDirection="ltr"
      offscreenPageLimit={1}
      overdrag
      onPageScroll={handlePageScroll}
      onPageSelected={handlePageSelected}
      orientation="horizontal"
    >
      {useMemo(
        () =>
          activeViews.map((view, index) => {
            const isActive = index === activeViewIndex
            const willVisible = index === activeViewIndex + 1 || index === activeViewIndex - 1
            if (!isActive && !willVisible) {
              return <View key={view} />
            }
            return (
              <PagerListVisibleContext value={isActive} key={view}>
                <PagerListWillVisibleContext value={willVisible}>
                  {renderItem(view, isActive)}
                </PagerListWillVisibleContext>
              </PagerListVisibleContext>
            )
          }),
        [activeViews, activeViewIndex, renderItem],
      )}
    </AnimatedPagerView>
  )
}

/**
 * Ported from bluesky-social/social-app
 * https://github.com/bluesky-social/social-app/blob/bf95345b333c56876cabf4c5b8516c431cc8ce9b/src/view/com/pager/Pager.tsx#L159-L190
 */
function usePagerHandlers(
  handlers: {
    onPageScroll: (e: PagerViewOnPageScrollEventData) => void
    onPageScrollStateChanged?: (e: PageScrollStateChangedNativeEventData) => void
    onPageSelected?: (e: PagerViewOnPageSelectedEventData) => void
  },
  dependencies: unknown[],
) {
  const { doDependenciesDiffer } = useHandler(handlers as any, dependencies)
  const subscribeForEvents = ["onPageScroll", "onPageScrollStateChanged", "onPageSelected"]
  return useEvent(
    (event) => {
      "worklet"
      const { onPageScroll, onPageScrollStateChanged, onPageSelected } = handlers
      if (event.eventName.endsWith("onPageScroll")) {
        onPageScroll(event as any as PagerViewOnPageScrollEventData)
      } else if (event.eventName.endsWith("onPageScrollStateChanged")) {
        onPageScrollStateChanged?.(event as any as PageScrollStateChangedNativeEventData)
      } else if (event.eventName.endsWith("onPageSelected")) {
        onPageSelected?.(event as any as PagerViewOnPageSelectedEventData)
      }
    },
    subscribeForEvents,
    doDependenciesDiffer,
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  PagerView: {
    flex: 1,
  },
})
