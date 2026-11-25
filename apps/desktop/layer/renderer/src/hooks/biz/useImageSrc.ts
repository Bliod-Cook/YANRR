import { env } from "@follow/shared/env.desktop"
import { getImageSrc, useProxiedImageSrc } from "@follow/utils/image-proxy"

import { getImageProxy, useImageProxy } from "~/atoms/image-proxy"
import { getGeneralSettings, useGeneralSettingKey } from "~/atoms/settings/general"

/** Where this device loads the image at `src` from, for code outside components */
export const toImageSrc = (src: string) =>
  getImageSrc(src, {
    mode: getGeneralSettings().imageProxyMode,
    proxy: getImageProxy(),
    serverUrl: env.VITE_API_URL,
  })

/** Where this device loads the image at `src` from, and how to fall back to `src` itself */
export const useImageSrc = (src: string | undefined) =>
  useProxiedImageSrc(src, {
    mode: useGeneralSettingKey("imageProxyMode"),
    proxy: useImageProxy(),
    serverUrl: env.VITE_API_URL,
    fallback: useGeneralSettingKey("imageProxyFallback"),
  })
