import { useRecyclingState } from "@shopify/flash-list"
import type {
  ImageErrorEventData,
  ImageLoadEventData,
  ImageProps as ExpoImageProps,
} from "expo-image"
import { Image as ExpoImage } from "expo-image"
import { useCallback, useMemo } from "react"
import { useColor } from "react-native-uikit-colors"

import { getSafeSource } from "./utils"

export type ImageProps = Omit<ExpoImageProps, "source"> & {
  source?: {
    uri: string
    headers?: Record<string, string>
  }
  blurhash?: string
  aspectRatio?: number
  hideOnError?: boolean
}

export const Image = ({
  ref,
  source,
  blurhash,
  aspectRatio,
  hideOnError,
  ...rest
}: ImageProps & { ref?: React.Ref<ExpoImage | null> }) => {
  const safeSource = useMemo(() => getSafeSource(source), [source])

  // Lists recycle rows for other items, so the load state follows the image it belongs to
  const [isError, setIsError] = useRecyclingState(false, [source?.uri])
  const onError = useCallback(
    (e: ImageErrorEventData) => {
      setIsError(true)
      rest.onError?.(e)
    },
    [rest],
  )

  const [isLoading, setIsLoading] = useRecyclingState(true, [source?.uri])
  const onLoad = useCallback(
    (e: ImageLoadEventData) => {
      setIsLoading(false, true)
      rest.onLoad?.(e)
    },
    [rest],
  )

  const backgroundColor = useColor("secondarySystemBackground")

  if (!source?.uri) {
    return null
  }

  if (hideOnError && isError) {
    return null
  }

  return (
    <ExpoImage
      recyclingKey={source?.uri}
      {...rest}
      source={safeSource}
      onError={onError}
      onLoad={onLoad}
      placeholder={{
        blurhash,
        ...(typeof rest.placeholder === "object" && { ...rest.placeholder }),
      }}
      placeholderContentFit="cover"
      style={[
        {
          aspectRatio,
          ...(typeof rest.style === "object" && { ...rest.style }),
          ...((isLoading || isError) && { backgroundColor }),
        },
        rest.style,
      ]}
      ref={ref}
    />
  )
}
