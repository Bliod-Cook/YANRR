import type { IncomingHttpHeaders } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { whoamiQueryKey } from "@follow/store/user/constants"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  ;(globalThis as { __DEV__?: boolean }).__DEV__ = false
  return {
    serverUrl: "",
    secureStore: new Map<string, string>(),
    invalidateQueries: vi.fn(async () => {}),
    resetQueries: vi.fn(async () => {}),
    reloadApp: vi.fn(async (_reason: string) => {}),
    invalidateSessionUser: vi.fn(),
  }
})

// The platform modules the Expo plugin of Better Auth imports
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}))
vi.mock("expo-constants", () => ({ default: {} }))
vi.mock("expo-linking", () => ({ createURL: () => "yanrr://" }))

vi.mock("@follow/store/sync/account", () => ({
  invalidateSessionUser: mocks.invalidateSessionUser,
  onLocalDataOfAnotherAccount: vi.fn(),
}))
vi.mock("@follow/store/user/store", () => ({
  userActions: { removeCurrentUser: vi.fn(async () => {}) },
}))
vi.mock("./local-data-reset", () => ({ scheduleLocalDataReset: vi.fn() }))
vi.mock("./native/user-agent", () => ({ getUserAgent: async () => "Yanrr" }))
vi.mock("./navigation/Navigation", () => ({
  Navigation: { rootNavigation: { popToRoot: vi.fn() } },
}))
vi.mock("./push-token", () => ({ unregisterPushToken: vi.fn(async () => {}) }))
vi.mock("./query-client", () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries, resetQueries: mocks.resetQueries },
}))
vi.mock("./reload-app", () => ({ reloadApp: mocks.reloadApp }))
vi.mock("./secure-store", () => ({
  safeSecureStore: {
    getItem: (key: string) => mocks.secureStore.get(key) ?? null,
    setItem: (key: string, value: string) => void mocks.secureStore.set(key, value),
    removeItemAsync: async (key: string) => void mocks.secureStore.delete(key),
  },
}))
vi.mock("./server-env", () => ({
  serverEnv: {
    get API_URL() {
      return `${mocks.serverUrl}/api`
    },
    get WEB_URL() {
      return mocks.serverUrl
    },
  },
}))

// The auth server, which sets the session cookie it is given on the next session request
const requests: { path: string; headers: IncomingHttpHeaders }[] = []
let nextSessionCookie: string | null = null
const server = createServer((request, response) => {
  requests.push({ path: request.url ?? "", headers: request.headers })
  response.setHeader("content-type", "application/json")
  if (request.url?.endsWith("/sign-out")) {
    response.setHeader("set-cookie", "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly")
    response.end(JSON.stringify({ success: true }))
    return
  }
  if (nextSessionCookie) response.setHeader("set-cookie", nextSessionCookie)
  response.end("null")
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
mocks.serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

const { authClient, signOut } = await import("./auth")

// A session request whose answer brings a session cookie, as after signing in
const receiveSession = async (token: string) => {
  nextSessionCookie = `better-auth.session_token=${token}; Max-Age=604800; Path=/; HttpOnly`
  await authClient.getSession()
  nextSessionCookie = null
}

afterAll(() => {
  server.close()
})

describe("signOut", () => {
  beforeEach(async () => {
    await receiveSession("session-token")
    requests.length = 0
    mocks.invalidateQueries.mockClear()
    mocks.resetQueries.mockClear()
    mocks.reloadApp.mockReset().mockResolvedValue(undefined)
    mocks.invalidateSessionUser.mockClear()
  })

  it("ends the session at the server and reloads without loading its queries again", async () => {
    await signOut()

    expect(requests.map((request) => request.path)).toEqual(["/api/better-auth/sign-out"])
    expect(requests[0]!.headers.cookie).toBe("better-auth.session_token=session-token")
    // The session is still treated as changed, so nothing queued goes out with it
    expect(mocks.invalidateSessionUser).toHaveBeenCalled()
    expect(mocks.resetQueries).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
    expect(mocks.reloadApp).toHaveBeenCalledWith("User sign out")
  })

  it("loads the queries again for a session that changes otherwise", async () => {
    await receiveSession("another-session-token")

    expect(mocks.resetQueries).toHaveBeenCalledWith({ queryKey: ["entries"] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: whoamiQueryKey })
  })

  it("shows the signed-out state when the app could not reload", async () => {
    const error = new Error("reload unavailable")
    mocks.reloadApp.mockRejectedValueOnce(error)

    await expect(signOut()).rejects.toBe(error)
    expect(mocks.resetQueries).toHaveBeenCalledWith({ queryKey: ["entries"] })

    // And the next sign-in loads its queries as usual
    mocks.resetQueries.mockClear()
    await receiveSession("next-session-token")
    expect(mocks.resetQueries).toHaveBeenCalledWith({ queryKey: ["entries"] })
  })
})

describe("authClient", () => {
  // The server refuses state-changing requests that carry the session cookie but no own origin
  it("sends the server's origin", async () => {
    requests.length = 0
    await authClient.getSession()

    expect(requests[0]!.headers.origin).toBe(mocks.serverUrl)
  })
})
