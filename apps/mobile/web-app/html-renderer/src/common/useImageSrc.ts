import { useProxiedImageSrc } from "@follow/utils/image-proxy"
import { useAtomValue } from "jotai"

import { imageProxyAtom } from "~/atoms"

/** Where the page loads the image at `src` from, and how to fall back to `src` itself */
export const useImageSrc = (src: string | undefined) =>
  useProxiedImageSrc(src, useAtomValue(imageProxyAtom))
