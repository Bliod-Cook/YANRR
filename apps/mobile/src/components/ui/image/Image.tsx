import { useRecyclingState } from "@shopify/flash-list"
import type {
  ImageErrorEventData,
  ImageLoadEventData,
  ImageProps as ExpoImageProps,
} from "expo-image"
import { Image as ExpoImage } from "expo-image"
import { useCallback, useMemo } from "react"
import { useColor } from "react-native-uikit-colors"

import { useImageProxy } from "@/src/atoms/image-proxy"
import { useGeneralSettingKey } from "@/src/atoms/settings/general"
import { toImageSrc } from "@/src/lib/image-proxy"

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
  const mode = useGeneralSettingKey("imageProxyMode")
  const fallback = useGeneralSettingKey("imageProxyFallback")
  const proxy = useImageProxy()
  // Lists recycle rows for other items, so the load state follows the image it belongs to
  const [direct, setDirect] = useRecyclingState(false, [source?.uri])
  const safeSource = useMemo(
    () => getSafeSource(source, { mode, proxy, direct }),
    [source, mode, proxy, direct],
  )
  const canFallBack =
    fallback && !direct && !!source?.uri && toImageSrc(source.uri, { mode, proxy }) !== source.uri

  const [isError, setIsError] = useRecyclingState(false, [source?.uri])
  const onError = useCallback(
    (e: ImageErrorEventData) => {
      if (canFallBack) {
        setDirect(true)
        return
      }
      setIsError(true)
      rest.onError?.(e)
    },
    [canFallBack, rest],
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
