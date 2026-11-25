import type { GeneralSettings } from "@follow/shared/settings/interface"
import { hmac } from "@noble/hashes/hmac.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { utf8ToBytes } from "@noble/hashes/utils.js"
import { useState } from "react"

import { imageRefererMatches } from "./image-referer"

export type ImageProxyMode = GeneralSettings["imageProxyMode"]

/** The image proxy the server names, and the key image URLs are signed with for it */
export interface ImageProxy {
  url: string
  key: string
}

export interface ImageSrcOptions {
  mode: ImageProxyMode
  proxy: ImageProxy | null | undefined
  /** The YANRR server, whose own images never go through the proxy */
  serverUrl: string
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

/**
 * Where to load the image at `src` from: through the proxy when `mode` says so, else `src` itself.
 * The proxy URL is `{proxy}/{signature}/{src}`, the signature being the HMAC-SHA256 of `src` with
 * the key, both in unpadded base64url. It never expires, so caches keep the image.
 */
export const getImageSrc = (src: string, { mode, proxy, serverUrl }: ImageSrcOptions): string => {
  if (mode === "off" || !proxy || !/^https?:\/\//.test(src)) return src
  if ((serverUrl && src.startsWith(serverUrl)) || src.startsWith(proxy.url)) return src
  if (mode === "hotlink" && !imageRefererMatches.some(({ url }) => url.test(src))) return src

  const url = utf8ToBytes(src)
  const signature = hmac(sha256, utf8ToBytes(proxy.key), url)
  return `${proxy.url.replace(/\/$/, "")}/${toBase64Url(signature)}/${toBase64Url(url)}`
}

/**
 * `getImageSrc` in a component, with `fallBack`, which switches to `src` itself after the proxy
 * failed when `fallback` allows it, telling whether it did.
 */
export const useProxiedImageSrc = (
  src: string | undefined,
  { fallback, ...options }: ImageSrcOptions & { fallback: boolean },
) => {
  const [failed, setFailed] = useState<string>()
  const shown = !src || failed === src ? src : getImageSrc(src, options)
  const canFallBack = fallback && shown !== src

  return {
    src: shown,
    fallBack: () => {
      if (canFallBack) setFailed(src)
      return canFallBack
    },
  }
}
