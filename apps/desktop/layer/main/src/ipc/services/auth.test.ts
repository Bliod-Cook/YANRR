import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthService } from "./auth"

const mocks = vi.hoisted(() => ({
  serverUrl: "",
  events: [] as string[],
  removeCookie: vi.fn(async (_url: string, _name: string) => {}),
}))

// Node's network stack stands in for Chromium's, which takes the same request
vi.mock("electron", () => ({
  net: { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
  session: { defaultSession: { cookies: { remove: mocks.removeCookie } } },
}))

vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))

vi.mock("../../lib/server-url", () => ({
  getApiURL: () => `${mocks.serverUrl}/api`,
  getServerUrl: () => mocks.serverUrl,
  getWebURL: () => mocks.serverUrl,
}))

vi.mock("../../lib/store", () => ({
  store: { get: vi.fn(), set: vi.fn() },
}))

describe("AuthService.signOut", () => {
  let server: Server

  beforeEach(async () => {
    mocks.events.length = 0
    mocks.removeCookie.mockClear()
    server = createServer((request, response) => {
      mocks.events.push(`${request.method} ${request.url} from ${request.headers.origin}`)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    mocks.serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  const sessionCookiesRemoved = () => mocks.removeCookie.mock.calls.map(([, name]) => name)

  it("ends the session with the server and on the device", async () => {
    await new AuthService().signOut()

    expect(mocks.events).toEqual([`POST /api/better-auth/sign-out from ${mocks.serverUrl}`])
    expect(sessionCookiesRemoved()).toEqual([
      "__Secure-better-auth.session_token",
      "better-auth.session_token",
    ])
  })

  it("leaves no session on the device when the server cannot be reached", async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))

    await new AuthService().signOut()

    expect(sessionCookiesRemoved()).toHaveLength(2)
  })
})
