import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { FollowClient } from "@follow-app/client-sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { OpmlImportItem } from "./opml-import"
import { importOpmlInBatches } from "./opml-import"

describe("importOpmlInBatches", () => {
  let server: Server
  let client: FollowClient
  const batches: OpmlImportItem[][] = []

  beforeEach(async () => {
    batches.length = 0
    // Imports what it is asked for, except that feeds marked old are already followed, feeds marked
    // bad fail, and a batch with a feed marked down fails as a whole
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      expect(request.headers["content-type"]).toContain("application/json")
      const { items } = JSON.parse(Buffer.concat(chunks).toString()) as {
        items: OpmlImportItem[]
      }
      batches.push(items)
      response.setHeader("content-type", "application/json")
      if (items.some((item) => item.url.includes("down"))) {
        response.statusCode = 401
        response.end(JSON.stringify({ code: 1001, message: "Unauthorized" }))
        return
      }
      const data = {
        successfulItems: items.filter(({ url }) => !/old|bad/.test(url)),
        conflictItems: items
          .filter(({ url }) => url.includes("old"))
          .map(({ url }) => ({ id: url, url })),
        parsedErrorItems: items.filter(({ url }) => url.includes("bad")),
      }
      response.end(JSON.stringify({ code: 0, data }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    client = new FollowClient({ baseURL: `http://127.0.0.1:${port}`, fetch })
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const feeds = (length: number, special: Record<number, string> = {}): OpmlImportItem[] =>
    Array.from({ length }, (_, index) => ({
      url: `https://example.com/${special[index] ?? index}`,
      title: `Feed ${index}`,
    }))

  it("sends the items a few per request and adds up the results", async () => {
    const items = feeds(10, { 3: "old", 5: "bad" })
    const progress: number[] = []

    const result = await importOpmlInBatches(client, items, (done) => progress.push(done))

    expect(batches).toEqual([items.slice(0, 8), items.slice(8)])
    expect(progress).toEqual([8, 10])
    expect(result.successfulItems).toHaveLength(8)
    expect(result.conflictItems).toEqual([{ id: items[3]!.url, url: items[3]!.url }])
    expect(result.parsedErrorItems).toEqual([items[5]])
  })

  it("rejects when a request fails as a whole and sends no later request", async () => {
    await expect(importOpmlInBatches(client, feeds(10, { 0: "down" }))).rejects.toThrow()

    expect(batches).toHaveLength(1)
  })
})
