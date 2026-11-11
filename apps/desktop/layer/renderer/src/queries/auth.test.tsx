import type { AuthClient } from "@follow/shared/auth"
import { authClientContext } from "@follow/store/context"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { setAppIsReady } from "~/atoms/app"

import { signOut, useSession } from "./auth"

const mocks = vi.hoisted(() => ({
  endSession: vi.fn(),
  clearLocalSessionData: vi.fn(async () => {}),
  reloadAtAppRoot: vi.fn(),
}))

// The request itself is tested against a server in `lib/auth.test.ts`
vi.mock("~/lib/auth", () => ({ endSession: mocks.endSession }))
vi.mock("~/store/utils/clear", () => ({ clearLocalSessionData: mocks.clearLocalSessionData }))
vi.mock("~/lib/reload-at-app-root", () => ({ reloadAtAppRoot: mocks.reloadAtAppRoot }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

describe("signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("starts over without the account's data once the session ended", async () => {
    mocks.endSession.mockResolvedValue({ error: null })

    await signOut()

    expect(mocks.clearLocalSessionData).toHaveBeenCalledTimes(1)
    expect(mocks.reloadAtAppRoot).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["the server refused", () => mocks.endSession.mockResolvedValue({ error: { status: 500 } })],
    [
      "the server could not be reached",
      () => mocks.endSession.mockRejectedValue(new TypeError("Failed to fetch")),
    ],
  ])("keeps the data and says so when %s: the user is still signed in", async (_, fail) => {
    fail()

    await signOut()

    expect(mocks.clearLocalSessionData).not.toHaveBeenCalled()
    expect(mocks.reloadAtAppRoot).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

describe("useSession", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  it("asks the server once the local database is open, where the answer is written", async () => {
    const getSession = vi.fn(async () => ({ data: null, error: null }))
    authClientContext.provide({ getSession } as unknown as AuthClient)
    const statuses: string[] = []
    const Probe = () => {
      statuses.push(useSession().status)
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Probe />
        </QueryClientProvider>,
      )
    })
    expect(getSession).not.toHaveBeenCalled()

    await act(async () => setAppIsReady(true))
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("unauthenticated"))
    await act(async () => root.unmount())

    expect(getSession).toHaveBeenCalledTimes(1)
  })
})
