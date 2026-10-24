import { cn } from "@follow/utils"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { StyleSheet, View } from "react-native"

import { ThemedBlurView } from "@/src/components/common/ThemedBlurView"
import { PlatformActivityIndicator } from "@/src/components/ui/loading/PlatformActivityIndicator"
import { PauseFillIcon } from "@/src/icons/pause_fill"
import { PlayFillIcon } from "@/src/icons/play_fill"
import type { SimpleMediaState } from "@/src/lib/player"

import { NativePressable } from "../pressable/NativePressable"

interface PlayerActionProps {
  /**
   * This is the state of the media instead of the play button.
   *
   * When the media is paused, the play button should be shown.
   */
  mediaState: SimpleMediaState
  onPress: () => void
  className?: string
  iconSize?: number
  buttonClassName?: string
}

export function PlayerAction({
  mediaState,
  onPress,
  className = "",
  iconSize = 24,
  buttonClassName = "",
}: PlayerActionProps) {
  const { t } = useTranslation()
  const handlePressPlay = useCallback(() => {
    onPress()
  }, [onPress])

  let playButtonIcon = <PlayFillIcon color="white" width={iconSize} height={iconSize} />
  switch (mediaState) {
    case "playing": {
      playButtonIcon = <PauseFillIcon color="white" width={iconSize} height={iconSize} />
      break
    }
    case "loading": {
      playButtonIcon = <PlatformActivityIndicator />
      break
    }
  }

  return (
    <NativePressable
      className={cn("absolute inset-0 flex items-center justify-center", className)}
      onPress={handlePressPlay}
      accessibilityRole="button"
      accessibilityLabel={mediaState === "playing" ? t("player.pause") : t("player.play")}
      accessibilityState={{ busy: mediaState === "loading" }}
    >
      <View className={cn("overflow-hidden rounded-full p-2", buttonClassName)}>
        <ThemedBlurView
          useGlass
          style={StyleSheet.absoluteFill}
          intensity={30}
          experimentalBlurMethod="none"
        />
        {playButtonIcon}
      </View>
    </NativePressable>
  )
}
