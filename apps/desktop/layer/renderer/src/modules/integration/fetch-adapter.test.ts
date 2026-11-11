// @vitest-environment node
import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import appEn from "@locales/app/en.json"
import i18next from "i18next"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { setIntegrationSetting } from "~/atoms/settings/integration"

import { sendIntegrationRequest } from "./fetch-adapter"

// The desktop app's page, whose bridge reaches a main process that answers every request itself
const mainProcess = vi.hoisted(() => {
  const requests: unknown[][] = []
  const bridge = {
    invoke: async (channel: string, ...args: unknown[]) => {
      requests.push([channel, ...args])
      return { ok: true, status: 201, statusText: "Created", headers: {}, data: "", text: "" }
    },
  }
  vi.stubGlobal("electron", bridge)
  // A setting change is announced as an event of the window
  vi.stubGlobal("window", { electron: bridge, dispatchEvent: () => true })
  return { requests }
})

const request = {
  method: "POST" as const,
  headers: { "content-type": "application/json", authorization: "Bearer secret-token" },
  body: '{"title":"A"}',
}

describe("sendIntegrationRequest", () => {
  let server: Server
  let origin: string
  const received: { method?: string; contentType?: string; body: string }[] = []

  beforeAll(async () => {
    await i18next.init({ lng: "en", resources: { en: { app: appEn } }, defaultNS: "app" })
    server = createServer(async (incoming, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(chunk as Buffer)
      received.push({
        method: incoming.method,
        contentType: incoming.headers["content-type"],
        body: Buffer.concat(chunks).toString(),
      })
      response.writeHead(202, "Accepted").end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it("leaves the request to the main process in the desktop app", async () => {
    setIntegrationSetting("useBrowserFetch", false)

    await expect(sendIntegrationRequest(`${origin}/hook`, request)).resolves.toMatchObject({
      ok: true,
      status: 201,
      statusText: "Created",
    })
    expect(mainProcess.requests).toEqual([
      ["integration.customFetch", { url: `${origin}/hook`, ...request }],
    ])
    expect(received).toEqual([])
  })

  it("sends it from the page when the user chose the browser's fetch", async () => {
    setIntegrationSetting("useBrowserFetch", true)

    await expect(sendIntegrationRequest(`${origin}/hook`, request)).resolves.toEqual({
      ok: true,
      status: 202,
      statusText: "Accepted",
    })
    expect(received).toEqual([
      { method: "POST", contentType: "application/json", body: '{"title":"A"}' },
    ])
  })

  it("explains a request the page could not send without naming its URL", async () => {
    setIntegrationSetting("useBrowserFetch", true)
    const unreachable = "http://127.0.0.1:9/hook?token=secret-token"

    const error = await sendIntegrationRequest(unreachable, request).catch((error: Error) => error)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(appEn["entry_actions.custom_integration.network_error"])
    expect((error as Error).message).not.toContain("secret-token")
  })
})
