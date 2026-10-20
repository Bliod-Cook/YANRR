import { FollowClient } from "@follow-app/client-sdk"
import { describe, expect, it, vi } from "vitest"

describe("FollowClient", () => {
  // The Yannr server serves the API under /api (see patches/@follow-app__client-sdk@0.3.98.patch)
  it("keeps the path of the base URL", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ code: 0, data: {} }), {
          headers: { "content-type": "application/json" },
        }),
    )
    const client = new FollowClient({ baseURL: "https://rss.example.com/api", fetch })

    await client.api.status.getConfigs()

    expect(String(fetch.mock.calls[0]![0])).toBe("https://rss.example.com/api/status/configs")
  })
})
