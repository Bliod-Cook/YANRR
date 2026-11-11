import type { IncomingHttpHeaders } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

const api = vi.hoisted(() => ({ url: "" }))

vi.mock("@follow/shared/env.desktop", () => ({
  env: {
    get VITE_API_URL() {
      return api.url
    },
  },
}))
vi.mock("../services", () => ({ AIPersistService: {} }))

const { createChatTransport } = await import("./transport")

type Seen = { method?: string; url?: string; headers: IncomingHttpHeaders }

describe("createChatTransport", () => {
  const seen: Seen[] = []
  const server = createServer((request, response) => {
    // The test page is on another origin than the API, which the dev server's page is too
    response.setHeader("access-control-allow-origin", request.headers.origin ?? "*")
    response.setHeader("access-control-allow-credentials", "true")
    response.setHeader("access-control-allow-headers", "content-type")
    if (request.method === "OPTIONS") {
      response.writeHead(204).end()
      return
    }
    seen.push({ method: request.method, url: request.url, headers: request.headers })
    if (request.url?.endsWith("/stream")) {
      response.writeHead(204).end()
      return
    }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end("data: [DONE]\n\n")
  })

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    api.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
  })
  afterAll(() => server.close())

  const transport = () =>
    createChatTransport({
      titleHandler: { chatId: "chat 1", shouldHandle: () => false, onTitleChange: () => {} },
    })
  const send = (trigger: "submit-message" | "regenerate-message") =>
    transport().sendMessages({
      trigger,
      chatId: "chat 1",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
    })

  test("sends, regenerates and resumes under the API URL with a plain request", async () => {
    await send("submit-message")
    await send("regenerate-message")
    await transport().reconnectToStream({ chatId: "chat 1" })

    expect(seen.map(({ method, url }) => [method, url])).toEqual([
      ["POST", "/api/ai/chat"],
      ["POST", "/api/ai/chat"],
      ["GET", "/api/ai/chat/chat%201/stream"],
    ])
    for (const { headers } of seen) {
      expect(Object.keys(headers).filter((name) => /^x-|cookie|authorization/i.test(name))).toEqual(
        [],
      )
    }
  })
})
