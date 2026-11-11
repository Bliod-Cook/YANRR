import { createBuildSafeHeaders } from "@follow/utils/headers"
import * as FileSystem from "expo-file-system/legacy"
import type { ImageProps, ImageSource } from "expo-image"
import { Image as ExpoImage } from "expo-image"
import { Asset, usePermissions } from "expo-media-library"
import * as Sharing from "expo-sharing"
import { t } from "i18next"
import { nanoid } from "nanoid/non-secure"
import { useCallback } from "react"

import { toSecureImageUrl } from "@/src/lib/image"
import { isNative } from "@/src/lib/platform"
import { serverEnv } from "@/src/lib/server-env"
import { toast } from "@/src/lib/toast"

import { getImageFileName } from "./image-file-name"

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

  source.uri = toSecureImageUrl(source.uri)

  return {
    ...source,
    headers: {
      ...buildSafeHeaders({ url: source.uri }),
      ...source.headers,
    },
  } satisfies ImageProps["source"]
}

const readHead = async (file: string) => {
  const base64 = await FileSystem.readAsStringAsync(file, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 16,
  })
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/**
 * Runs `task` with the original file of the image, removed once `task` is done: the one the image
 * views cached, or else a download with the headers they load the image with.
 */
const withImageFile = async <T>(uri: string, task: (file: string) => Promise<T>) => {
  const url = toSecureImageUrl(uri)
  const dir = `${FileSystem.cacheDirectory}image-${nanoid()}/`
  await FileSystem.makeDirectoryAsync(dir)
  try {
    const downloaded = `${dir}download`
    const cachePath = await ExpoImage.getCachePathAsync(url)
    if (cachePath) {
      await FileSystem.copyAsync({ from: `file://${cachePath}`, to: downloaded })
    } else {
      const { status } = await FileSystem.downloadAsync(url, downloaded, {
        headers: buildSafeHeaders({ url }),
      })
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
    }
    const file = `${dir}${getImageFileName(url, await readHead(downloaded))}`
    await FileSystem.moveAsync({ from: downloaded, to: file })
    return await task(file)
  } finally {
    await FileSystem.deleteAsync(dir, { idempotent: true })
  }
}

export async function shareImage(uri: string) {
  try {
    await withImageFile(uri, (file) => Sharing.shareAsync(file, { dialogTitle: t("image.share") }))
  } catch (error) {
    toast.error(t("image.share_failed", { error: String(error) }))
  }
}

const saveImageToMediaLibrary = (uri: string) => withImageFile(uri, (file) => Asset.create(file))

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
          await saveImageToMediaLibrary(uri)
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
