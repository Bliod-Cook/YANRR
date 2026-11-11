import type { IncomingMessage, Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { proxyApiRequest } from "./api-proxy"

// Node's network stack stands in for Chromium's, which takes the same request. It keeps no
// cookies; that Chromium sends and stores the session cookie is checked in the app itself.
vi.mock("electron", () => ({
  net: { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
}))

const PAGE_ORIGIN = "app://yanrr"

const pageRequest = (path: string, init?: RequestInit, initiatorOrigin: string = PAGE_ORIGIN) =>
  Object.assign(new Request(`app://yanrr${path}`, init), { initiatorOrigin })

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

describe("proxyApiRequest", () => {
  let server: Server
  let serverUrl: string
  let received: { method?: string; url?: string; origin?: string; cookie?: string; body: Buffer }[]
  let closed: number

  beforeEach(async () => {
    received = []
    closed = 0
    server = createServer(async (request, response) => {
      received.push({
        method: request.method,
        url: request.url,
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        body: await readBody(request),
      })
      response.on("close", () => closed++)

      if (request.url === "/api/hanging") return
      if (request.url === "/api/endless") {
        response.writeHead(200, { "content-type": "text/event-stream" })
        response.write("data: 1\n\n")
        return
      }
      response.writeHead(201, {
        "content-type": "application/octet-stream",
        "set-cookie": "better-auth.session_token=secret; HttpOnly",
      })
      response.end(Buffer.from([0xff, 0x00, 0xfe]))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.useRealTimers()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  const proxy = (request: Request) =>
    proxyApiRequest(request, { server: serverUrl, pageOrigin: PAGE_ORIGIN })

  it("answers the app's page with the server's answer, bytes kept as they are", async () => {
    const body = new Uint8Array([0x80, 0x00, 0xc3])

    const response = await proxy(
      pageRequest("/api/subscriptions/import?view=1", { method: "POST", body }),
    )

    expect(response.status).toBe(201)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0, 0xfe]))
    expect(received).toEqual([
      {
        method: "POST",
        url: "/api/subscriptions/import?view=1",
        // The only origin the server trusts
        origin: serverUrl,
        cookie: undefined,
        body: Buffer.from(body),
      },
    ])
  })

  it("leaves the session cookie to Chromium's cookie store", async () => {
    const response = await proxy(
      pageRequest("/api/better-auth/sign-in/email", {
        method: "POST",
        headers: { cookie: "better-auth.session_token=made-up" },
      }),
    )

    // Not the page's to send, nor to see
    expect(received[0]!.cookie).toBeUndefined()
    expect(response.headers.has("set-cookie")).toBe(false)
  })

  it.each([
    ["a page in a webview", "https://evil.example"],
    ["a page without an origin", "null"],
    ["no page at all", undefined],
  ])("refuses %s, whose request would go out with the session", async (_, initiatorOrigin) => {
    const request = Object.assign(new Request("app://yanrr/api/entries", { method: "POST" }), {
      initiatorOrigin,
    })

    const response = await proxy(request)

    expect(response.status).toBe(403)
    expect(received).toEqual([])
  })

  it("ends the request to the server when the page gives up on the answer", async () => {
    const response = await proxy(pageRequest("/api/endless"))

    await response.body!.cancel()

    await vi.waitFor(() => expect(closed).toBe(1))
  })

  it("gives up on a server that never starts answering", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const settled = expect(proxy(pageRequest("/api/hanging"))).rejects.toThrow()
    await vi.waitFor(() => expect(received).toHaveLength(1))

    vi.advanceTimersByTime(240_000)

    await settled
  })
})
