import { cn } from "@follow/utils"
import { useEffect } from "react"
import { View } from "react-native"
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

import { useShouldShowPlayerBar } from "./hooks"
import { PlayerBarContent } from "./PlayerBarContent"

export function PlayerTabBar({ className }: { className?: string }) {
  const isVisible = useShouldShowPlayerBar()
  const isVisibleSV = useSharedValue(isVisible ? 1 : 0)
  useEffect(() => {
    isVisibleSV.value = withTiming(isVisible ? 1 : 0)
  }, [isVisible, isVisibleSV])
  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: isVisibleSV.value,
      height: interpolate(isVisibleSV.value, [0, 1], [0, 56]),
      overflow: "hidden",
    }
  })
  return (
    <Animated.View
      style={animatedStyle}
      className={cn("border-b-hairline border-opaque-separator/50 px-2", className)}
    >
      <View className="flex-row items-center gap-4 overflow-hidden rounded-2xl p-2">
        <PlayerBarContent
          testID="player-tab-bar"
          artworkSize={48}
          artworkClassName="size-12 rounded-lg"
          titleClassName="text-lg font-semibold text-label"
          controlsClassName="mr-2"
        />
      </View>
    </Animated.View>
  )
}
