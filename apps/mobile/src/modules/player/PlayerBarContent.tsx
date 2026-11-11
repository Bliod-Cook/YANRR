import { cn } from "@follow/utils"
import { Pressable, View } from "react-native"

import { Text } from "@/src/components/ui/typography/Text"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { useActivePlayable } from "@/src/lib/player"
import { PlayerScreen } from "@/src/screens/PlayerScreen"
import { usePrefetchImageColors } from "@/src/store/image/hooks"

import { PlayPauseButton, SeekButton, StopButton } from "./control"
import { PlayerArtwork } from "./PlayerArtwork"

/** What every player bar shows: what is playing, which opens the player, and its controls */
export function PlayerBarContent({
  testID,
  artworkSize,
  artworkClassName,
  titleClassName,
  controlsClassName,
}: {
  testID: string
  /** Size on screen in points */
  artworkSize: number
  artworkClassName: string
  titleClassName: string
  controlsClassName?: string
}) {
  const activePlayable = useActivePlayable()
  // The player screen's background comes from the artwork's colors
  usePrefetchImageColors(activePlayable?.artwork ?? undefined)
  const navigation = useNavigation()
  return (
    <>
      <Pressable
        testID={testID}
        className="flex-1 flex-row items-center gap-3"
        onPress={() => {
          navigation.presentControllerView(PlayerScreen, void 0, "transparentModal")
        }}
      >
        <PlayerArtwork playable={activePlayable} size={artworkSize} className={artworkClassName} />
        <View className="flex-1 overflow-hidden">
          <Text className={titleClassName} numberOfLines={1}>
            {activePlayable?.title ?? ""}
          </Text>
        </View>
      </Pressable>
      <View className={cn("flex-row items-center gap-4", controlsClassName)}>
        <PlayPauseButton />
        <SeekButton />
        <StopButton />
      </View>
    </>
  )
}
