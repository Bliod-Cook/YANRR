import type { FeedViewType } from "@follow/constants"
import type { MediaModel } from "@follow/database/schemas/types"
import { useRecyclingState } from "@shopify/flash-list"
import type { ImageSource } from "expo-image"
import type { ReactNode, Ref } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ScrollView, View } from "react-native"
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"

import { Image } from "../image/Image"
import { ImageContextMenu } from "../image/ImageContextMenu"
import { getSafeSource } from "../image/utils"
import { NativePressable } from "../pressable/NativePressable"
import { VideoPlayer } from "../video/VideoPlayer"
import { getCarouselPages } from "./carousel-pages"

export const MediaCarousel = ({
  ref,
  entryId,
  media,
  onPreview,
  aspectRatio,
  view,
  entryActions,
  footer,
}: {
  ref?: Ref<View>
  entryId: string
  media: MediaModel[]
  onPreview?: (index: number, thumbnail: ImageSource | undefined) => void
  aspectRatio: number
  view: FeedViewType
  /** Menu items of the entry, shown in the context menu of each image */
  entryActions?: ReactNode
  footer?: ReactNode
}) => {
  const [containerWidth, setContainerWidth] = useState(0)
  const containerHeight = Math.floor(containerWidth / aspectRatio)
  const pages = useMemo(() => getCarouselPages(media), [media])
  const hasMany = pages.length > 1

  // The list recycles this row for other entries, which start at their first image
  const scrollViewRef = useRef<ScrollView>(null)
  const [activeIndex, setActiveIndex] = useRecyclingState(0, [entryId], () => {
    scrollViewRef.current?.scrollTo({ x: 0, animated: false })
  })

  return (
    <View
      onLayout={(e) => {
        setContainerWidth(e.nativeEvent.layout.width)
      }}
    >
      {/* Sized by the aspect ratio before the width is measured: a row laid out without its image
          is so short that the list mounts far more rows than fit on screen */}
      <View ref={ref} className="relative overflow-hidden rounded-md" style={{ aspectRatio }}>
        <ScrollView
          ref={scrollViewRef}
          onMomentumScrollEnd={(e) => {
            setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / containerWidth))
          }}
          scrollEnabled={hasMany}
          horizontal
          showsHorizontalScrollIndicator={false}
          pagingEnabled
          className="flex-1"
          // We need to fixed the height of the container to prevent the carousel from resizing
          // See https://github.com/Shopify/flash-list/issues/797
          style={{ height: containerHeight }}
        >
          {pages.map(({ media: m, index, imageUrl }, position) => {
            // An entry can carry dozens of images, so only the visible page and its neighbors load,
            // and only once the card is measured
            if (!containerWidth || Math.abs(position - activeIndex) > 1) {
              return (
                <View key={imageUrl} style={{ width: containerWidth, height: containerHeight }} />
              )
            }
            const ImageItem = (
              <NativePressable
                onPress={() => {
                  // The lightbox shows the image this card already loaded
                  onPreview?.(index, getSafeSource({ uri: imageUrl }))
                }}
              >
                <Image
                  source={{ uri: imageUrl }}
                  blurhash={m.blurhash}
                  className="w-full"
                  aspectRatio={aspectRatio}
                  placeholderContentFit="cover"
                />
              </NativePressable>
            )

            if (m.type === "photo") {
              return (
                <View
                  key={imageUrl}
                  className="relative"
                  style={{ width: containerWidth, height: containerHeight }}
                >
                  <ImageContextMenu imageUrl={imageUrl} entryActions={entryActions}>
                    {ImageItem}
                  </ImageContextMenu>
                </View>
              )
            } else if (m.type === "video") {
              return (
                <ImageContextMenu key={imageUrl} imageUrl={imageUrl} entryActions={entryActions}>
                  <VideoPlayer
                    source={m.url}
                    height={containerHeight}
                    width={containerWidth}
                    placeholder={ImageItem}
                    view={view}
                  />
                </ImageContextMenu>
              )
            } else {
              return null
            }
          })}
        </ScrollView>

        {/* Indicators */}
        {hasMany && (
          <View className="absolute inset-x-0 bottom-0 flex-row items-center justify-center gap-1">
            {pages.map(({ imageUrl }, position) => (
              <Indicator key={imageUrl} index={position} activeIndex={activeIndex} />
            ))}
          </View>
        )}
      </View>
      {footer}
    </View>
  )
}

const Indicator = ({ index, activeIndex }: { index: number; activeIndex: number }) => {
  const activeValue = useSharedValue(0)
  useEffect(() => {
    activeValue.value = withSpring(index === activeIndex ? 1 : 0)
  }, [activeIndex, activeValue, index])
  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeValue.value,
      [0, 1],
      ["rgba(0, 0, 0, 0.5)", "rgba(255, 255, 255, 0.9)"],
    ),
  }))
  return <Animated.View className="h-1 flex-1 rounded-sm" style={animatedStyle} />
}
