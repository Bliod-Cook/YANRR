import type { Session } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildManagedAuthCookieHeader,
  dedupeManagedAuthCookies,
  persistManagedAuthCookiesFromSetCookieHeader,
} from "./auth-cookies"

vi.mock("~/manager/window", () => ({ WindowManager: { getMainWindow: () => null } }))

describe("auth cookies", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it("builds a cookie header from managed auth cookies only", () => {
    const header = buildManagedAuthCookieHeader([
      { name: "__Secure-better-auth.session_token", value: "session-token" },
      { name: "better-auth.session_data", value: "session-data" },
      { name: "dont_remember", value: "true" },
      { name: "unrelated", value: "ignore-me" },
    ])

    expect(header).toBe(
      "__Secure-better-auth.session_token=session-token; better-auth.session_data=session-data; dont_remember=true",
    )
  })

  it("deduplicates session token cookies when building a cookie header", () => {
    const header = buildManagedAuthCookieHeader([
      {
        name: "better-auth.session_token",
        value: "legacy-token",
        domain: ".api.folo.is",
        hostOnly: false,
        path: "/",
        secure: true,
      },
      {
        name: "__Secure-better-auth.session_token",
        value: "domain-token",
        domain: ".api.folo.is",
        hostOnly: false,
        path: "/",
        secure: true,
      },
      {
        name: "__Secure-better-auth.session_token",
        value: "host-token.signature",
        domain: "api.folo.is",
        hostOnly: true,
        path: "/",
        secure: true,
      },
      { name: "dont_remember", value: "true" },
    ])

    expect(header).toBe(
      "__Secure-better-auth.session_token=host-token.signature; dont_remember=true",
    )
  })

  it("persists managed auth cookies and removes expired ones from a set-cookie header", async () => {
    const set = vi.fn().mockImplementation(async () => {})
    const remove = vi.fn().mockImplementation(async () => {})
    const get = vi.fn().mockResolvedValue([])

    await persistManagedAuthCookiesFromSetCookieHeader({
      apiURL: "https://api.folo.is",
      session: {
        cookies: { get, set, remove },
      } as unknown as Session,
      setCookieHeader: [
        "better-auth.session_data=session-data; Path=/; HttpOnly; Secure; SameSite=None",
        "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None",
      ].join(", "),
    })

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.folo.is",
        name: "better-auth.session_data",
        value: "session-data",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "no_restriction",
      }),
    )
    expect(remove).not.toHaveBeenCalled()
  })

  it("persists session token cookies across app restarts when the server sends Max-Age", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"))

    const set = vi.fn().mockImplementation(async () => {})
    const remove = vi.fn().mockImplementation(async () => {})
    const get = vi.fn().mockResolvedValue([])

    await persistManagedAuthCookiesFromSetCookieHeader({
      apiURL: "https://api.folo.is",
      session: {
        cookies: { get, set, remove },
      } as unknown as Session,
      setCookieHeader:
        "__Secure-better-auth.session_token=session-token; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=None",
    })

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "__Secure-better-auth.session_token",
        value: "session-token",
        expirationDate: 1_781_136_000,
      }),
    )
  })

  it("keeps rememberMe=false session token cookies session-scoped", async () => {
    const set = vi.fn().mockImplementation(async () => {})
    const remove = vi.fn().mockImplementation(async () => {})
    const get = vi.fn().mockResolvedValue([])

    await persistManagedAuthCookiesFromSetCookieHeader({
      apiURL: "https://api.folo.is",
      session: {
        cookies: { get, set, remove },
      } as unknown as Session,
      setCookieHeader:
        "__Secure-better-auth.session_token=session-token; Path=/; HttpOnly; Secure; SameSite=None",
    })

    expect(set).toHaveBeenCalledWith(
      expect.not.objectContaining({
        expirationDate: expect.any(Number),
      }),
    )
  })

  it("removes stale duplicate session token cookies while keeping the secure host-only cookie", async () => {
    const remove = vi.fn().mockImplementation(async () => {})
    const get = vi.fn().mockResolvedValue([
      {
        name: "better-auth.session_token",
        value: "legacy-token",
        domain: ".api.folo.is",
        hostOnly: false,
        path: "/",
        secure: true,
        sameSite: "no_restriction",
      },
      {
        name: "__Secure-better-auth.session_token",
        value: "domain-token",
        domain: ".api.folo.is",
        hostOnly: false,
        path: "/",
        secure: true,
        sameSite: "no_restriction",
      },
      {
        name: "__Secure-better-auth.session_token",
        value: "host-token.signature",
        domain: "api.folo.is",
        hostOnly: true,
        path: "/",
        secure: true,
        sameSite: "no_restriction",
      },
    ])

    await dedupeManagedAuthCookies({
      apiURL: "https://api.folo.is",
      session: {
        cookies: { get, remove },
      } as unknown as Session,
    })

    expect(remove).toHaveBeenCalledWith(
      "https://__folo_cookie_cleanup__.api.folo.is/",
      "better-auth.session_token",
    )
    expect(remove).toHaveBeenCalledWith(
      "https://__folo_cookie_cleanup__.api.folo.is/",
      "__Secure-better-auth.session_token",
    )
    expect(remove).toHaveBeenCalledTimes(2)
  })
})
