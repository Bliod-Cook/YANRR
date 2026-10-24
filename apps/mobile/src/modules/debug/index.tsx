import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { useMemo } from "react"
import { Dimensions } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ReAnimatedPressable } from "@/src/components/common/AnimatedComponents"
import { BugLineIcon } from "@/src/icons/bug_line"
import { JotaiPersistSyncStorage } from "@/src/lib/jotai"
import { Navigation } from "@/src/lib/navigation/Navigation"
import { DebugScreen } from "@/src/screens/(headless)/DebugScreen"

export const DebugButton = () => {
  const cachedPositionAtom = useMemo(
    () =>
      atomWithStorage<{ x: number; y: number }>(
        "debug-button-position",
        {
          x: 0,
          y: 50,
        },
        JotaiPersistSyncStorage,
        {
          getOnInit: true,
        },
      ),
    [],
  )
  const insets = useSafeAreaInsets()
  const windowWidth = Dimensions.get("window").width
  const [point, setPoint] = useAtom(cachedPositionAtom)
  const translateX = useSharedValue(point.x)
  const translateY = useSharedValue(point.y)
  const startX = useSharedValue(point.x)
  const startY = useSharedValue(point.y)
  const openDebugScreen = () => {
    Navigation.rootNavigation.pushControllerView(DebugScreen)
  }
  const gestureEvent = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value
      startY.value = translateY.value
    })
    .onChange((event) => {
      translateX.value = startX.value + event.translationX
      translateY.value = startY.value + event.translationY
    })
    .onEnd((event) => {
      if (Math.abs(event.translationX) < 5 && Math.abs(event.translationY) < 5) {
        runOnJS(openDebugScreen)()
        return
      }
      const snapToLeft = true
      const finalX = snapToLeft ? insets.left : windowWidth - 40 - insets.right
      translateX.value = withSpring(finalX)
      translateY.value = withSpring(startY.value + event.translationY)
      runOnJS(setPoint)({
        x: finalX,
        y: startY.value + event.translationY,
      })
    })
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateX: translateX.value,
        },
        {
          translateY: translateY.value,
        },
      ],
    }
  })
  return (
    <GestureDetector gesture={gestureEvent}>
      <ReAnimatedPressable
        onPress={() => {
          openDebugScreen()
        }}
        style={animatedStyle}
        className="absolute right-0 top-[-20] z-[100] mt-5 flex size-8 items-center justify-center rounded-l-md bg-accent"
      >
        <BugLineIcon height={24} width={24} color="#fff" />
      </ReAnimatedPressable>
    </GestureDetector>
  )
}
