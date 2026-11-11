import type { AuthClient } from "@follow/shared/auth"
import { authClientContext, queryClientContext } from "@follow/store/context"
import { whoami } from "@follow/store/user/getters"
import { userActions } from "@follow/store/user/store"
import { afterEach, describe, expect, it, vi } from "vitest"

import { followClient } from "./api-client"
import { queryClient } from "./query-client"

vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "https://rss.example.com/api")
})

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

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

describe("requests the server refuses for lack of a session", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    queryClient.clear()
  })

  it("have the session asked for once, and its end signs the app out", async () => {
    // The session ended on the server: it knows nobody, and refuses everything else
    const getSession = vi.fn(async () => ({ data: null, error: null }))
    authClientContext.provide({ getSession } as unknown as AuthClient)
    queryClientContext.provide(queryClient)
    await userActions.upsertMany([{ id: "1", isMe: true }])
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ code: 1000, message: "Unauthorized" }, 401),
    )

    await Promise.allSettled([
      followClient.api.feeds.get({ id: "1" }),
      followClient.api.feeds.get({ id: "2" }),
      followClient.api.feeds.get({ id: "3" }),
    ])
    await vi.waitFor(() => expect(whoami()).toBeNull())
    await followClient.api.feeds.get({ id: "4" }).catch(() => {})

    expect(getSession).toHaveBeenCalledTimes(1)
  })
})
