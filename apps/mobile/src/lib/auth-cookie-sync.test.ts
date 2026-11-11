import { expoClient } from "@better-auth/expo/client"
import type { Mock } from "vitest"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createSessionAwareAuthCookieStorage, hasAuthSessionChanged } from "./auth-cookie-sync"

// The platform modules the Expo plugin imports
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: {} }))
vi.mock("expo-constants", () => ({ default: {} }))
vi.mock("expo-linking", () => ({ createURL: () => "yanrr://" }))

const createStoredCookie = ({
  token = "session-token",
  tokenExpires = "2026-09-01T12:00:00.000Z",
  data = "session-data",
  dataExpires = "2026-09-01T12:00:00.000Z",
  extra = {},
}: {
  token?: string | null
  tokenExpires?: string | null
  data?: string | null
  dataExpires?: string | null
  extra?: Record<string, { expires: string | null; value: string }>
} = {}) =>
  JSON.stringify({
    ...(token === null
      ? {}
      : {
          "better-auth.session_token": {
            value: token,
            expires: tokenExpires,
          },
        }),
    ...(data === null
      ? {}
      : {
          "better-auth.session_data": {
            value: data,
            expires: dataExpires,
          },
        }),
    ...extra,
  })

describe("the stored auth cookie", () => {
  const cookieKey = "follow_auth_cookie"
  let values: Map<string, string>
  let onSessionChange: Mock<() => void>
  let respond: (setCookie: string) => Promise<void>

  beforeEach(() => {
    values = new Map()
    onSessionChange = vi.fn()
    const storage = createSessionAwareAuthCookieStorage({
      cookieKey,
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
      },
      onSessionChange,
    })
    const { onSuccess } = expoClient({
      scheme: "yanrr",
      storagePrefix: "follow_auth",
      storage,
      disableCache: true,
    }).fetchPlugins[0]!.hooks
    // A response of the auth server, as the Expo plugin sees it
    respond = (setCookie) =>
      onSuccess({
        request: { url: "https://rss.example.com/api/better-auth/get-session" },
        response: new Response(null, { headers: { "set-cookie": setCookie } }),
        data: null,
      } as unknown as Parameters<typeof onSuccess>[0])
  })

  it("tells when a response signs in", async () => {
    await respond("better-auth.session_token=first; Max-Age=604800; Path=/; HttpOnly")

    expect(onSessionChange).toHaveBeenCalledTimes(1)
  })

  it("keeps quiet when a response only extends the session", async () => {
    await respond("better-auth.session_token=first; Max-Age=604800; Path=/; HttpOnly")
    await respond("better-auth.session_token=first; Max-Age=1209600; Path=/; HttpOnly")

    expect(onSessionChange).toHaveBeenCalledTimes(1)
  })

  it("tells when a response signs out", async () => {
    await respond("better-auth.session_token=first; Max-Age=604800; Path=/; HttpOnly")
    await respond("better-auth.session_token=; Max-Age=0; Path=/; HttpOnly")

    expect(onSessionChange).toHaveBeenCalledTimes(2)
  })

  it("follows the session in a cookie too large for one keychain entry", async () => {
    const large = `better-auth.dont_remember=${"x".repeat(2000)}; Max-Age=604800; Path=/`
    const withSession = (token: string, maxAge: number) =>
      `better-auth.session_token=${token}; Max-Age=${maxAge}; Path=/, ${large}`

    await respond(withSession("first", 604800))
    expect([...values.keys()].filter((key) => key.startsWith(`${cookieKey}.`))).not.toEqual([])
    await respond(withSession("first", 1209600))
    expect(onSessionChange).toHaveBeenCalledTimes(1)

    await respond(withSession("second", 604800))
    expect(onSessionChange).toHaveBeenCalledTimes(2)
  })
})

describe("hasAuthSessionChanged", () => {
  it("ignores expiry and ancillary cookie updates when the session values stay the same", () => {
    const previousCookie = createStoredCookie({
      extra: {
        "better-auth.dont_remember": {
          value: "old-value",
          expires: "2026-09-01T12:00:00.000Z",
        },
      },
    })
    const nextCookie = createStoredCookie({
      tokenExpires: "2026-09-02T12:00:00.000Z",
      dataExpires: "2026-09-02T12:00:00.000Z",
      extra: {
        "better-auth.dont_remember": {
          value: "new-value",
          expires: "2026-09-02T12:00:00.000Z",
        },
      },
    })

    expect(hasAuthSessionChanged(previousCookie, nextCookie)).toBe(false)
  })

  it.each([
    ["adds a session token", createStoredCookie({ token: null }), createStoredCookie()],
    ["removes a session token", createStoredCookie(), createStoredCookie({ token: null })],
    ["changes a session token", createStoredCookie(), createStoredCookie({ token: "next-token" })],
    ["changes session data", createStoredCookie(), createStoredCookie({ data: "next-data" })],
  ])("detects when the auth session %s", (_name, previousCookie, nextCookie) => {
    expect(hasAuthSessionChanged(previousCookie, nextCookie)).toBe(true)
  })

  it("treats malformed stored cookies as a session change", () => {
    expect(hasAuthSessionChanged("not-json", "not-json")).toBe(true)
    expect(hasAuthSessionChanged(createStoredCookie(), "[]")).toBe(true)
  })
})
