import { createWriteStream } from "node:fs"
import { pipeline } from "node:stream"
import { promisify } from "node:util"

import { net } from "electron"

const streamPipeline = promisify(pipeline)

export async function downloadFile(url: string, dest: string) {
  const res = await net.fetch(url)

  // Check whether it responds successfully.
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.statusText}`)
  }
  if (!res.body) {
    throw new Error(`Failed to get response body`)
  }
  await streamPipeline(res.body as any, createWriteStream(dest))
}
