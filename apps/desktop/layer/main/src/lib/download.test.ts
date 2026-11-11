import fsp from "node:fs/promises"
import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"

import path from "pathe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadFile } from "./download"

// Node's network stack stands in for Chromium's, which takes the same request
vi.mock("electron", () => ({
  net: { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
}))

describe("downloadFile", () => {
  let server: Server
  let serverUrl: string
  let dir: string

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "yanrr-download-"))
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" })
      response.write("first half")
      // The rest never comes: the connection drops once the first half arrived, or the server
      // stops sending
      if (request.url === "/dropped") setTimeout(() => response.destroy(), 200)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.useRealTimers()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await fsp.rm(dir, { force: true, recursive: true })
  })

  it("leaves no truncated file when the connection drops", async () => {
    const dest = path.join(dir, "video.mp4")

    await expect(downloadFile(`${serverUrl}/dropped`, dest)).rejects.toThrow()

    await expect(fsp.access(dest)).rejects.toThrow()
  })

  it("gives up on a server that stops sending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const dest = path.join(dir, "video.mp4")

    const download = expect(downloadFile(`${serverUrl}/stalled`, dest)).rejects.toThrow()
    await vi.waitFor(async () => expect((await fsp.readFile(dest, "utf8")).length).toBe(10))
    vi.advanceTimersByTime(30_000)

    await download
    await expect(fsp.access(dest)).rejects.toThrow()
  })
})
