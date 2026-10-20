import { createBuildSafeHeaders } from "@follow/utils/headers"
import ImageEditor from "@react-native-community/image-editor"
import * as FileSystem from "expo-file-system/legacy"
import type { ImageProps, ImageSource } from "expo-image"
import { Asset, usePermissions } from "expo-media-library"
import * as Sharing from "expo-sharing"
import { t } from "i18next"
import { useCallback } from "react"
import { Image } from "react-native"

import { isAndroid, isNative } from "@/src/lib/platform"
import { serverEnv } from "@/src/lib/server-env"
import { toast } from "@/src/lib/toast"

const buildSafeHeaders = createBuildSafeHeaders(serverEnv.WEB_URL, [serverEnv.API_URL])

// Type guard to check if source is an ImageSource with uri property
function isImageSourceWithUri(
  source: ImageProps["source"],
): source is ImageSource & { uri: string } {
  return (
    source !== null &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    "uri" in source &&
    typeof source.uri === "string"
  )
}

export const getSafeSource = (source: ImageProps["source"]) => {
  if (!isImageSourceWithUri(source)) {
    console.warn("Invalid image source", source)
    return
  }

  // Now TypeScript knows source has a uri property
  source.uri = source.uri.replace("http://", "https://")

  return {
    ...source,
    headers: {
      ...buildSafeHeaders({ url: source.uri }),
      ...source.headers,
    },
  } satisfies ImageProps["source"]
}

const getImageData = async (imageUrl: string) => {
  let size = await Image.getSize(imageUrl)

  // Workaround for Android where the size returned by Image.getSize is not accurate for remote images
  // Learn more https://github.com/facebook/react-native/issues/33498
  if (isAndroid) {
    size = {
      width: size.width * 10,
      height: size.height * 10,
    }
  }

  const croppedImage = await ImageEditor.cropImage(imageUrl, {
    offset: {
      x: 0,
      y: 0,
    },
    size,
    format: "png",
    includeBase64: true,
  })

  return croppedImage
}

const createTempFile = async (base64: string, filename: string) => {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Cache directory is not available")
  }
  const fileUri = await FileSystem.getInfoAsync(FileSystem.cacheDirectory)
  const filePath = `${fileUri.uri}/${filename}`
  await FileSystem.writeAsStringAsync(filePath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })

  return {
    filePath,
    cleanup: () => FileSystem.deleteAsync(filePath),
  }
}

export function extractFilenameFromUrl(uri: string): string {
  // Extract actual filename from URL, removing any query parameters
  const urlWithoutParams = uri.split(/[?#]/).at(0)
  const lastSegment = urlWithoutParams?.split("/").pop() || "image"
  return lastSegment
}

export async function shareImage({ uri }: { uri: string }) {
  if (!(await Sharing.isAvailableAsync())) {
    // TODO might need to give an error to the user in this case -prf
    return
  }
  const croppedImage = await getImageData(uri)
  const filename = `${extractFilenameFromUrl(uri)}.png`

  const { filePath, cleanup } = await createTempFile(croppedImage.base64, filename)
  await Sharing.shareAsync(filePath, {
    mimeType: "image/png",
    dialogTitle: t("image.share"),
  })

  cleanup()
}

export const saveImageToMediaLibrary = async ({ uri }: { uri: string }) => {
  const croppedImage = await getImageData(uri)
  const filename = `${extractFilenameFromUrl(uri)}.png`
  const { filePath, cleanup } = await createTempFile(croppedImage.base64, filename)
  await Asset.create(filePath)
  cleanup()
}

/**
 * Same as `saveImageToMediaLibrary`, but also handles permissions and toasts
 *
 * Ported from https://github.com/bluesky-social/social-app/blob/a0ea634349fd7eac40d72dbd57339f1d6c53a117/src/lib/media/save-image.ts
 *
 * @example
 * ```ts
 * const saveImageToAlbum = useSaveImageToMediaLibrary()
 * ```
 */
export function useSaveImageToMediaLibrary() {
  const [permissionResponse, requestPermission, getPermission] = usePermissions({
    writeOnly: true,
  })
  return useCallback(
    async (uri: string) => {
      if (!isNative) {
        throw new Error("useSaveImageToMediaLibrary is native only")
      }

      async function save() {
        try {
          await saveImageToMediaLibrary({ uri })
          toast.success(t("image.saved"))
        } catch (e) {
          toast.error(t("image.save_failed", { error: String(e) }))
        }
      }

      const permission = permissionResponse ?? (await getPermission())

      if (permission.granted) {
        await save()
      } else {
        if (permission.canAskAgain) {
          // request again once
          const askAgain = await requestPermission()
          if (askAgain.granted) {
            await save()
          } else {
            // since we've been explicitly denied, show a toast.
            toast.error(t("image.permission_required"), {
              duration: 5000,
            })
          }
        } else {
          toast.info(t("image.permission_denied"), {
            duration: 5000,
          })
        }
      }
    },
    [permissionResponse, requestPermission, getPermission],
  )
}
