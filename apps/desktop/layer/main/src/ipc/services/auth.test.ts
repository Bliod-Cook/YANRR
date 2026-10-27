import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthService } from "./auth"

const server = vi.hoisted(() => ({ url: "" }))

// Chromium's network stack stands in for Node's, which takes the same signal.
vi.mock("electron", () => ({
  net: { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
}))

vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))

vi.mock("~/manager/window", () => ({
  WindowManager: { getMainWindow: () => null },
}))

vi.mock("../../lib/server-url", () => ({
  getApiURL: () => `${server.url}/api`,
  getServerUrl: () => server.url,
  getWebURL: () => server.url,
}))

vi.mock("../../lib/store", () => ({
  store: { get: vi.fn(), set: vi.fn() },
}))

vi.mock("../../lib/user", () => ({
  deleteNotificationsToken: vi.fn(),
  updateNotificationsToken: vi.fn(),
}))

describe("AuthService.fetchWithAuth", () => {
  let hanging: Server
  let pending = 0

  beforeEach(async () => {
    // Takes requests and never answers, like a stuck proxy.
    hanging = createServer(() => {
      pending++
    })
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve))
    server.url = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.useRealTimers()
    hanging.closeAllConnections()
    await new Promise((resolve) => hanging.close(resolve))
    pending = 0
  })

  const request = (requestId: string) => ({
    method: "GET",
    url: `${server.url}/api/status/configs`,
    requestId,
  })

  it("stops a request the renderer cancels", async () => {
    const service = new AuthService()
    const sent = service.fetchWithAuth(request("first"))
    await vi.waitFor(() => expect(pending).toBe(1))

    service.cancelFetch("first")

    await expect(sent).rejects.toThrow()
  })

  it("gives up on its own when nobody cancels", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const service = new AuthService()
    const sent = service.fetchWithAuth(request("orphan"))
    const settled = expect(sent).rejects.toThrow()
    await vi.waitFor(() => expect(pending).toBe(1))

    vi.advanceTimersByTime(240_000)

    await settled
  })
})
