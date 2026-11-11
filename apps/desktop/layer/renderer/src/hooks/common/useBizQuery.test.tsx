import { whoamiQueryKey } from "@follow/store/user/hooks"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test, vi } from "vitest"

import { defineQuery } from "~/lib/defineQuery"

import { useAuthQuery } from "./useBizQuery"

describe("useAuthQuery", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  test("waits while the login modal is open, also when the caller enables the query", async () => {
    const client = new QueryClient()
    // The server said that nobody is signed in
    client.setQueryData(whoamiQueryKey, null)
    const fetchProfile = vi.fn(async () => "profile")
    const Probe = () => {
      useAuthQuery(defineQuery(["profile"], fetchProfile), { enabled: true })
      return null
    }

    const root = createRoot(document.createElement("div"))
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      )
    })
    await act(async () => {
      root.unmount()
    })

    expect(fetchProfile).not.toHaveBeenCalled()
  })
})
