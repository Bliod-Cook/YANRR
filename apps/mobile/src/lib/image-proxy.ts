import type { ImageProxy, ImageProxyMode } from "@follow/utils/image-proxy"
import { getImageSrc } from "@follow/utils/image-proxy"

import { getImageProxy } from "../atoms/image-proxy"
import { getGeneralSettings } from "../atoms/settings/general"
import { serverEnv } from "./server-env"

/**
 * Where this device loads the image at `src` from: through the image proxy when the settings say
 * so. Components pass the settings they render with, so that a change renders them again.
 */
export const toImageSrc = (
  src: string,
  {
    mode = getGeneralSettings().imageProxyMode,
    proxy = getImageProxy(),
  }: { mode?: ImageProxyMode; proxy?: ImageProxy | null } = {},
) => getImageSrc(src, { mode, proxy, serverUrl: serverEnv.API_URL })
