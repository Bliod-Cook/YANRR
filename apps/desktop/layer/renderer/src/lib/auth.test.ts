// @vitest-environment node
import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// A browser: no preload script handed the page anything
vi.stubGlobal("window", {})

describe("the requests that start and end a session", () => {
  let server: Server
  let auth: typeof import("./auth")
  const received: { url?: string; body: unknown }[] = []

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
      received.push({ url: request.url, body })

      const refused = body.password === "wrong-password"
      response.writeHead(refused ? 401 : 200, { "content-type": "application/json" })
      response.end(
        JSON.stringify(
          refused
            ? { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }
            : { token: "t", user: { id: "1" } },
        ),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    vi.stubEnv("VITE_WEB_URL", `http://127.0.0.1:${port}`)
    vi.stubEnv("VITE_API_URL", `http://127.0.0.1:${port}/api`)
    auth = await import("./auth")
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it("resolve without an error once the server took them", async () => {
    await expect(auth.signInWithEmail("me@example.com", "right-password")).resolves.toEqual({
      error: null,
    })
    await expect(auth.signUpWithEmail("new@example.com", "right-password")).resolves.toEqual({
      error: null,
    })
    await expect(auth.endSession()).resolves.toEqual({ error: null })

    expect(received).toEqual([
      {
        url: "/api/better-auth/sign-in/email",
        body: { email: "me@example.com", password: "right-password" },
      },
      {
        url: "/api/better-auth/sign-up/email",
        // An account needs a name; the part before the @ is as good as any
        body: { email: "new@example.com", password: "right-password", name: "new" },
      },
      { url: "/api/better-auth/sign-out", body: {} },
    ])
  })

  it("resolve with the error the server refused with", async () => {
    const { error } = await auth.signInWithEmail("me@example.com", "wrong-password")

    expect(error).toMatchObject({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })
  })

  it("throw when the server cannot be reached", async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))

    await expect(auth.signInWithEmail("me@example.com", "right-password")).rejects.toThrow()
    // A browser stays signed in then: only the server can take the cookie back
    await expect(auth.endSession()).rejects.toThrow()
  })
})

describe("the desktop app's auth client", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("reaches the API on the page's own origin, where the main process answers", async () => {
    vi.resetModules()
    vi.stubEnv("VITE_WEB_URL", "https://rss.example.com")
    vi.stubEnv("VITE_API_URL", "app://yanrr/api")
    const requested = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ token: "t", user: { id: "1" } }))
    const { signInWithEmail } = await import("./auth")

    await expect(signInWithEmail("me@example.com", "right-password")).resolves.toEqual({
      error: null,
    })

    expect(String(requested.mock.calls[0]![0])).toBe("app://yanrr/api/better-auth/sign-in/email")
  })
})
