import type { JotaiSyncStorage } from "@follow/utils"
import { createAtomHooks } from "@follow/utils"
import type { ImageProxy } from "@follow/utils/image-proxy"
import { atomWithStorage } from "jotai/utils"

import { JotaiPersistSyncStorage } from "../lib/jotai"

/** The server's image proxy, kept so that the first images after a start already load through it */
export const [, , useImageProxy, , getImageProxy, setImageProxy] = createAtomHooks(
  atomWithStorage<ImageProxy | null>(
    "image-proxy",
    null,
    JotaiPersistSyncStorage as JotaiSyncStorage<ImageProxy | null>,
    { getOnInit: true },
  ),
)
