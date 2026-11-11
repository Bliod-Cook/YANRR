import { useTypeScriptHappyCallback } from "@follow/hooks/shared"
import { cn } from "@follow/utils"
import type { PropsWithChildren } from "react"
import { use, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import type { ScrollView, ScrollViewProps, StyleProp, ViewProps, ViewStyle } from "react-native"
import { View } from "react-native"
import type { AnimatedProps, SharedValue } from "react-native-reanimated"
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated"
import type { ReanimatedScrollEvent } from "react-native-reanimated/lib/typescript/hook/commonTypes"
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context"

import { useBottomTabBarHeight } from "@/src/components/layouts/tabbar/hooks"
import { useTabScreenIsFocused } from "@/src/lib/navigation/bottom-tab/hooks"
import { useScreenIsInSheetModal } from "@/src/lib/navigation/hooks"
import { ScreenItemContext } from "@/src/lib/navigation/ScreenItemContext"

import { ReAnimatedScrollView } from "../../common/AnimatedComponents"
import type { InternalNavigationHeaderProps } from "../header/NavigationHeader"
import { InternalNavigationHeader } from "../header/NavigationHeader"
import { BottomTabBarBackgroundContext } from "../tabbar/contexts/BottomTabBarBackgroundContext"
import { getNavigationHeaderLayout } from "../utils"
import {
  NavigationHeaderHeightContext,
  SetNavigationHeaderHeightContext,
} from "./NavigationHeaderContext"

type SafeNavigationScrollViewProps = Omit<ScrollViewProps, "onScroll"> & {
  onScroll?: (e: ReanimatedScrollEvent) => void

  // For scroll view content adjustment behavior
  withTopInset?: boolean
  withBottomInset?: boolean

  // to sharedValue
  reanimatedScrollY?: SharedValue<number>

  contentViewStyle?: StyleProp<ViewStyle>
  contentViewClassName?: string
  contentContainerMaxWidth?: number

  Header?: React.ReactNode
  ScrollViewBottom?: React.ReactNode
} & PropsWithChildren

export interface ForwardedSafeNavigationScrollView extends ScrollView {
  checkScrollToBottom: () => void
}
export const SafeNavigationScrollView = ({
  ref: forwardedRef,
  children,
  onScroll,
  withBottomInset = false,
  withTopInset = false,
  reanimatedScrollY,
  contentViewClassName,
  contentViewStyle,
  contentContainerMaxWidth,
  Header,
  ScrollViewBottom,
  ...props
}: SafeNavigationScrollViewProps & { ref?: React.Ref<ScrollView | null> }) => {
  const insets = useSafeAreaInsets()
  const tabBarHeight = useBottomTabBarHeight()

  const frame = useSafeAreaFrame()
  const resolvedContentContainerWidth = contentContainerMaxWidth
    ? Math.min(frame.width, contentContainerMaxWidth)
    : undefined
  const sheetModal = useScreenIsInSheetModal()
  const [headerHeight, setHeaderHeight] = useState(
    () =>
      getNavigationHeaderLayout({
        landscape: frame.width > frame.height,
        sheetModal,
        topInset: insets.top,
      }).headerHeight,
  )
  const screenCtxValue = use(ScreenItemContext)

  const ref = useRef<ScrollView>(null)
  const { opacity } = use(BottomTabBarBackgroundContext)

  // All tab screens stay mounted, so only the focused one may drive the shared tab bar background.
  // Otherwise a hidden tab whose content fits the screen (e.g. Settings) clears it over the visible one.
  const tabScreenIsFocused = useTabScreenIsFocused()
  const isFocused = useSharedValue(tabScreenIsFocused)
  useLayoutEffect(() => {
    isFocused.value = tabScreenIsFocused
  }, [isFocused, tabScreenIsFocused])

  // The tab bar background clears while the content is scrolled to its end
  const scrollY = useSharedValue(0)
  const viewportHeight = useSharedValue(0)
  const contentHeight = useSharedValue(0)
  const checkScrollToBottom = useCallback(() => {
    "worklet"
    if (!isFocused.value) return
    const nextOpacity = scrollY.value + viewportHeight.value >= contentHeight.value - 1 ? 0 : 1
    if (opacity.value !== nextOpacity) {
      opacity.value = nextOpacity
    }
  }, [contentHeight, isFocused, opacity, scrollY, viewportHeight])

  useImperativeHandle(forwardedRef, () => {
    return Object.assign({}, ref.current!, {
      checkScrollToBottom,
    })
  })

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      if (reanimatedScrollY) {
        reanimatedScrollY.value = event.contentOffset.y
      }
      if (onScroll) {
        runOnJS(onScroll)(event)
      }
      screenCtxValue.reAnimatedScrollY.value = event.contentOffset.y
      scrollY.value = event.contentOffset.y
      viewportHeight.value = event.layoutMeasurement.height
      contentHeight.value = event.contentSize.height
      checkScrollToBottom()
    },
  })

  return (
    <NavigationHeaderHeightContext value={headerHeight}>
      <SetNavigationHeaderHeightContext value={setHeaderHeight}>
        {Header}
        <ReAnimatedScrollView
          ref={ref}
          onScroll={scrollHandler}
          onContentSizeChange={useTypeScriptHappyCallback(
            (w, h) => {
              screenCtxValue.scrollViewContentHeight.value = h
              contentHeight.value = h
              checkScrollToBottom()
            },
            [screenCtxValue.scrollViewContentHeight, contentHeight, checkScrollToBottom],
          )}
          onLayout={useTypeScriptHappyCallback(
            (e) => {
              screenCtxValue.scrollViewHeight.value = e.nativeEvent.layout.height - headerHeight
              viewportHeight.value = e.nativeEvent.layout.height
              checkScrollToBottom()
            },
            [screenCtxValue.scrollViewHeight, headerHeight, viewportHeight, checkScrollToBottom],
          )}
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{
            top: headerHeight,
            bottom: tabBarHeight,
          }}
          {...props}
        >
          <View style={{ height: headerHeight - (withTopInset ? insets.top : 0) }} />
          <View
            style={[
              contentContainerMaxWidth
                ? {
                    width: resolvedContentContainerWidth,
                    alignSelf: "center",
                  }
                : undefined,
              contentViewStyle,
            ]}
            className={cn("flex-1", contentViewClassName)}
          >
            {children}
          </View>
          {ScrollViewBottom}
          <View style={{ height: tabBarHeight - (withBottomInset ? insets.bottom : 0) }} />
        </ReAnimatedScrollView>
      </SetNavigationHeaderHeightContext>
    </NavigationHeaderHeightContext>
  )
}

export const NavigationBlurEffectHeaderView = ({
  headerHideableBottom,
  headerHideableBottomHeight,
  headerTitleAbsolute,
  containerStyle,
  ...props
}: InternalNavigationHeaderProps & {
  headerHideableBottom?: () => React.ReactNode
  headerHideableBottomHeight?: number
  headerTitleAbsolute?: boolean
  /**
   * Animated style applied to the absolutely positioned header container,
   * e.g. to slide the header away while reading.
   */
  containerStyle?: AnimatedProps<ViewProps>["style"]
}) => {
  const hideableBottom = headerHideableBottom?.()
  return (
    <Animated.View className="absolute inset-x-0 top-0 z-[99]" style={containerStyle}>
      <InternalNavigationHeader
        title={props.title}
        headerRight={props.headerRight}
        headerLeft={props.headerLeft}
        hideableBottom={hideableBottom}
        hideableBottomHeight={headerHideableBottomHeight}
        hideableBottomRevealKey={props.hideableBottomRevealKey}
        headerTitleAbsolute={headerTitleAbsolute}
        headerTitle={props.headerTitle}
        promptBeforeLeave={props.promptBeforeLeave}
        isLoading={props.isLoading}
      />
    </Animated.View>
  )
}
