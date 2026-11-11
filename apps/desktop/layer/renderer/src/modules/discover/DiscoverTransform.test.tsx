import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"
import { Queries } from "~/queries"

import { DiscoverTransform } from "./DiscoverTransform"

vi.mock("@follow/shared/env.desktop", () => ({
  env: {
    VITE_API_URL: "https://api.example.com",
    VITE_WEB_URL: "https://app.example.com",
  },
}))

describe("DiscoverTransform", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  test("says so when the RSSHub instance offers no transform route", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData(Queries.discover.rsshubNamespace({ namespace: "rsshub" }).key, {})
    const host = document.createElement("div")
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Provider store={jotaiStore}>
            <DiscoverTransform />
          </Provider>
        </QueryClientProvider>,
      )
    })

    expect(host.textContent).toContain("discover.transform.unavailable")
    await act(async () => {
      root.unmount()
    })
  })
})
