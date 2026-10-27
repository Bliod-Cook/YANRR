import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { FollowClient } from "@follow-app/client-sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { apiContext } from "../../context"
import type { FollowAPI } from "../../types"
import { importOpmlInBatches } from "./opml-import"

describe("importOpmlInBatches", () => {
  let server: Server
  const batches: string[][] = []

  beforeEach(async () => {
    batches.length = 0
    // Imports what it is asked for, except that a batch with a broken feed fails as a whole
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const form = await new Response(Buffer.concat(chunks), {
        headers: { "content-type": request.headers["content-type"]! },
      }).formData()
      const urls = JSON.parse(form.get("items") as string) as string[]
      batches.push(urls)
      response.setHeader("content-type", "application/json")
      if (urls.some((url) => url.includes("broken"))) {
        response.statusCode = 500
        response.end(JSON.stringify({ code: 1005, message: "Internal error" }))
        return
      }
      const data = {
        successfulItems: urls.filter((url) => !url.includes("old")).map((url) => ({ url })),
        conflictItems: urls.filter((url) => url.includes("old")).map((url) => ({ id: url, url })),
        parsedErrorItems: [],
      }
      response.end(JSON.stringify({ code: 0, data }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    const client = new FollowClient({ baseURL: `http://127.0.0.1:${port}`, fetch })
    apiContext.provide(client.api as unknown as FollowAPI)
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it("imports a few feeds per request and adds up the results", async () => {
    const urls = Array.from({ length: 10 }, (_, index) =>
      index === 3 ? "https://example.com/old" : `https://example.com/${index}`,
    )
    const progress: number[] = []

    const result = await importOpmlInBatches(new Blob(["<opml/>"]), urls, (done) =>
      progress.push(done),
    )

    expect(batches).toEqual([urls.slice(0, 8), urls.slice(8)])
    expect(progress).toEqual([8, 10])
    expect(result.successfulItems).toHaveLength(9)
    expect(result.conflictItems).toEqual([{ id: urls[3], url: urls[3] }])
  })

  it("counts the feeds of a failed request as failed and goes on with the rest", async () => {
    const urls = Array.from({ length: 10 }, (_, index) =>
      index === 0 ? "https://example.com/broken" : `https://example.com/${index}`,
    )

    const result = await importOpmlInBatches(new Blob(["<opml/>"]), urls)

    expect(result.parsedErrorItems.map((item) => item.url)).toEqual(urls.slice(0, 8))
    expect(result.successfulItems.map((item) => item.url)).toEqual(urls.slice(8))
  })
})
