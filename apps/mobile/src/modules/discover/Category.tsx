import type { RSSHubCategory } from "@follow/constants"
import { CategoryMap, RSSHubCategories } from "@follow/constants"
import { LinearGradient } from "expo-linear-gradient"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native"
import { useColor } from "react-native-uikit-colors"

import { Grid } from "@/src/components/ui/grid"
import { ItemPressableStyle } from "@/src/components/ui/pressable/enum"
import { ItemPressable } from "@/src/components/ui/pressable/ItemPressable"
import { Text } from "@/src/components/ui/typography/Text"
import { FilterCuteReIcon } from "@/src/icons/filter_cute_re"
import { Grid2CuteReIcon } from "@/src/icons/grid_2_cute_re"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { Recommendations } from "@/src/modules/discover/Recommendations"
import { DiscoverSettingsScreen } from "@/src/screens/(modal)/DiscoverSettingsScreen"
import { RecommendationCategoryScreen } from "@/src/screens/(stack)/recommendation/RecommendationCategoryScreen"

import { getCategoryGridColumns } from "./category-columns"

export const Category = () => {
  const { t } = useTranslation("common")
  const { t: tSettings } = useTranslation("settings")
  const navigation = useNavigation()
  const label = useColor("label")
  const columns = getCategoryGridColumns(useWindowDimensions().width)
  return (
    <>
      <View className="mt-4 flex-row items-center justify-between pb-1 pl-6 pr-5 pt-4">
        <View className="flex-row items-center gap-2">
          <Grid2CuteReIcon width={24} height={24} color={label} />
          <Text className="pb-2 text-xl font-bold leading-[1.1] text-label">
            {t("words.categories")}
          </Text>
        </View>
        <ItemPressable
          className="rounded-lg p-1"
          itemStyle={ItemPressableStyle.UnStyled}
          accessibilityRole="button"
          accessibilityLabel={tSettings("discoverFilters.title")}
          onPress={() => {
            navigation.presentControllerView(DiscoverSettingsScreen)
          }}
        >
          <FilterCuteReIcon width={20} height={20} color={label} />
        </ItemPressable>
      </View>

      <Grid columns={columns} gap={12} className="p-4">
        {RSSHubCategories.map((category) => (
          <CategoryItem key={category} category={category} />
        ))}
      </Grid>
    </>
  )
}

const CategoryEmoji = ({ emoji }: { emoji: string }) => (
  <View style={styles.emojiContainer}>
    <Text allowFontScaling={false} style={styles.emojiText}>
      {emoji}
    </Text>
  </View>
)

const CategoryItem = memo(({ category }: { category: RSSHubCategory }) => {
  const { t } = useTranslation("common")
  const name = t(`discover.category.${category}`)
  const navigation = useNavigation()
  const { emoji } = CategoryMap[category]
  return (
    <Pressable
      className="overflow-hidden rounded-2xl"
      key={category}
      onPress={() => {
        if (category === "all") {
          navigation.pushControllerView(Recommendations)
        } else {
          navigation.pushControllerView(RecommendationCategoryScreen, {
            category,
          })
        }
      }}
    >
      <LinearGradient
        colors={[`${CategoryMap[category].color}80`, CategoryMap[category].color]}
        start={{
          x: 0,
          y: 0,
        }}
        end={{
          x: 0,
          y: 1,
        }}
        className="rounded-2xl p-4"
        style={styles.cardItem}
      >
        {/* The emoji sits above the name, so a long name cannot run into it */}
        <View className="flex-1">
          <CategoryEmoji emoji={emoji} />
          {/* A margin, not padding: Android fits the font to the view's width, padding included */}
          <Text
            className="ml-2 text-lg font-bold text-white"
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {name}
          </Text>
        </View>
      </LinearGradient>
    </Pressable>
  )
})
const styles = StyleSheet.create({
  cardItem: {
    aspectRatio: 16 / 9,
  },
  // Takes the height the name leaves
  emojiContainer: {
    flex: 1,
    alignItems: "flex-end",
    paddingHorizontal: 8,
  },
  emojiText: {
    fontSize: 32,
    lineHeight: 40,
    textAlign: "center",
    ...(Platform.OS === "android"
      ? {
          includeFontPadding: false,
        }
      : {}),
  },
})
