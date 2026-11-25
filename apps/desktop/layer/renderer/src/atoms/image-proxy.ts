import type { ImageProxy } from "@follow/utils/image-proxy"
import { getStorageNS } from "@follow/utils/ns"
import { atomWithStorage } from "jotai/utils"

import { createAtomHooks } from "~/lib/jotai"

/** The server's image proxy, kept so that the first images after a start already load through it */
export const [, , useImageProxy, , getImageProxy, setImageProxy] = createAtomHooks(
  atomWithStorage<ImageProxy | null>(getStorageNS("image-proxy"), null, undefined, {
    getOnInit: true,
  }),
)
