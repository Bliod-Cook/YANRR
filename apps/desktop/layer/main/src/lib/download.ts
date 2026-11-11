import { createWriteStream } from "node:fs"
import { rm } from "node:fs/promises"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream } from "node:stream/web"

import { net } from "electron"

/** A download is given up after this long without a byte from the server, however long it runs */
const STALL_TIMEOUT_MS = 30_000

export async function downloadFile(url: string, dest: string) {
  const stalled = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const receiving = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stalled.abort(new Error(`Download stalled: ${url}`)), STALL_TIMEOUT_MS)
  }

  receiving()
  try {
    const res = await net.fetch(url, { signal: stalled.signal })
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.statusText}`)
    }
    if (!res.body) {
      throw new Error(`Failed to get response body`)
    }

    // From here on the file at `dest` is overwritten
    try {
      await pipeline(
        Readable.fromWeb(res.body as ReadableStream<Uint8Array>),
        new Transform({
          transform(chunk, _encoding, callback) {
            receiving()
            callback(null, chunk)
          },
        }),
        createWriteStream(dest),
      )
    } catch (error) {
      await rm(dest, { force: true })
      throw error
    }
  } finally {
    clearTimeout(timer)
  }
}
