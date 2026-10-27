import { afterEach, describe, expect, it, vi } from "vitest"

import { followClient } from "./api-client"

vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "https://rss.example.com/api")
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("followClient responses", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses a JSON body once", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: 0, data: {} }))
    const parse = vi.spyOn(Response.prototype, "json")

    await followClient.api.status.getConfigs()

    expect(parse).toHaveBeenCalledTimes(1)
  })

  it("still reads errors and empty answers", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: 2001, message: "Feed not found" }, 404))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(followClient.api.feeds.get({ id: "1" })).rejects.toMatchObject({
      status: 404,
      message: "Feed not found",
    })
    await expect(followClient.api.status.getConfigs()).resolves.toBeDefined()
  })
})
