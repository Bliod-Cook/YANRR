import { clsx } from "@follow/utils"
import { GlassView } from "expo-glass-effect"
import { StyleSheet, View } from "react-native"

import { useShouldShowPlayerBar } from "./hooks"
import { PlayerBarContent } from "./PlayerBarContent"

export function GlassPlayerTabBar({ className }: { className?: string }) {
  const isVisible = useShouldShowPlayerBar()

  if (!isVisible) return null

  return (
    <View className={clsx("mx-6", className)}>
      <View className="my-6 h-[56px] flex-1">
        <GlassView style={styles.glass} glassEffectStyle="regular" />
        <View className="flex-row items-center gap-4 overflow-hidden rounded-2xl p-2 px-3">
          <PlayerBarContent
            testID="player-tab-bar"
            artworkSize={48}
            artworkClassName="size-12 rounded-full"
            titleClassName="text-lg font-semibold text-label"
            controlsClassName="mr-2"
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: 99,
    ...StyleSheet.absoluteFill,
  },
})
