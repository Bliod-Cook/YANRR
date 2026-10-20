import { useImageColors } from "@follow/store/image/hooks"
import { useWhoami } from "@follow/store/user/hooks"
import { cn } from "@follow/utils"
import { LinearGradient } from "expo-linear-gradient"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Pressable, StyleSheet, View } from "react-native"
import type { SharedValue } from "react-native-reanimated"
import ReAnimated, { FadeIn, FadeOut, interpolate, useAnimatedStyle } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useColor } from "react-native-uikit-colors"

import { UserAvatar } from "@/src/components/ui/avatar/UserAvatar"
import { Text } from "@/src/components/ui/typography/Text"
import { useNavigation, useScreenIsInSheetModal } from "@/src/lib/navigation/hooks"
import { LoginScreen } from "@/src/screens/(modal)/LoginScreen"
import { usePrefetchImageColors } from "@/src/store/image/hooks"

import { isUserHeaderGradientLight, USER_HEADER_BANNER_TOP_SPACING } from "./layout"

const defaultGradientColors = ["#000", "#100", "#200"]

export const UserHeaderBanner = ({ scrollY }: { scrollY: SharedValue<number> }) => {
  const { t } = useTranslation()
  const bgColor = useColor("systemGroupedBackground")
  const avatarIconColor = useColor("secondaryLabel")
  const user = useWhoami()
  usePrefetchImageColors(user?.image)
  const insets = useSafeAreaInsets()
  const MAX_PULL = 100
  const SCALE_FACTOR = 1.8
  const imageColors = useImageColors(user?.image)
  const gradientColors = useMemo(() => {
    if (!imageColors || imageColors.platform === "web")
      return user ? defaultGradientColors : [bgColor, bgColor, bgColor]
    if (imageColors.platform === "android") {
      return [
        imageColors.dominant,
        imageColors.average || imageColors.vibrant,
        imageColors.vibrant || imageColors.dominant,
      ]
    }
    return [imageColors.primary, imageColors.secondary, imageColors.background]
  }, [bgColor, imageColors, user])
  const gradientLight = isUserHeaderGradientLight(imageColors)
  const styles = useAnimatedStyle(() => {
    const scaleValue = interpolate(scrollY.value, [-MAX_PULL, 0], [SCALE_FACTOR, 1], {
      extrapolateLeft: "extend",
      extrapolateRight: "clamp",
    })
    return {
      transform: [
        {
          scale: scaleValue,
        },
      ],
    }
  })

  // Add animated style for avatar
  const avatarStyles = useAnimatedStyle(() => {
    // Scale avatar when pulling down
    const avatarScale = interpolate(scrollY.value, [-MAX_PULL, 0], [1.3, 1], {
      extrapolateLeft: "extend",
      extrapolateRight: "clamp",
    })

    // Move avatar up when pulling down
    const avatarTranslateY = interpolate(scrollY.value, [-MAX_PULL, 0], [-20, 0], {
      extrapolateLeft: "extend",
      extrapolateRight: "clamp",
    })
    return {
      transform: [
        {
          scale: avatarScale,
        },
        {
          translateY: avatarTranslateY,
        },
      ],
    }
  })
  const navigation = useNavigation()

  const sheetModal = useScreenIsInSheetModal()
  const bannerContainerStyle = useMemo(
    () => ({
      marginTop: sheetModal ? 0 : -insets.top - USER_HEADER_BANNER_TOP_SPACING,
      paddingTop: sheetModal ? 48 : USER_HEADER_BANNER_TOP_SPACING,
    }),
    [insets.top, sheetModal],
  )
  const bannerContentStyle = useMemo(
    () => ({
      paddingTop: insets.top,
    }),
    [insets.top],
  )
  return (
    <View className="relative items-center justify-center" style={bannerContainerStyle}>
      <ReAnimated.View entering={FadeIn} className="absolute inset-0" style={styles}>
        <LinearGradient
          colors={defaultGradientColors as [string, string, ...string[]]}
          start={{
            x: 0,
            y: 0,
          }}
          end={{
            x: 1,
            y: 1,
          }}
          style={StyleSheet.absoluteFill}
        />
        {gradientColors && (
          <ReAnimated.View style={StyleSheet.absoluteFill} entering={FadeIn} exiting={FadeOut}>
            <LinearGradient
              colors={gradientColors as [string, string, ...string[]]}
              start={{
                x: 0,
                y: 0,
              }}
              end={{
                x: 1,
                y: 1,
              }}
              style={StyleSheet.absoluteFill}
            />
          </ReAnimated.View>
        )}
      </ReAnimated.View>
      <View className="items-center px-4 pb-[24px]" style={bannerContentStyle}>
        <ReAnimated.View style={avatarStyles} className="rounded-full bg-system-background">
          <UserAvatar
            image={user?.image}
            name={user?.name}
            size={60}
            className={!user?.name ? "bg-system-grouped-background" : ""}
            color={avatarIconColor}
          />
        </ReAnimated.View>

        <View className="mt-2 items-center">
          {user?.name ? (
            <Text
              numberOfLines={2}
              className={cn(
                "px-8 text-center text-xl font-bold",
                gradientLight ? "text-black" : "text-white/95",
              )}
            >
              {user.name}
            </Text>
          ) : (
            <Text className="text-xl font-bold text-text">{t("settings.folo_account")}</Text>
          )}

          {!user && (
            <Pressable
              className="mx-auto"
              testID="settings-sign-in"
              onPress={() => navigation.presentControllerView(LoginScreen)}
            >
              <Text className="m-[6] text-sm text-accent">{t("settings.sign_in_cta")}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}
