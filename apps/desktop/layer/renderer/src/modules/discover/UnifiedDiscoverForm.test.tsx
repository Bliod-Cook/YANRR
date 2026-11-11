import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { beforeAll, describe, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { UnifiedDiscoverForm } from "./UnifiedDiscoverForm"

vi.mock("@follow/shared/env.desktop", () => ({
  env: {
    VITE_API_URL: "https://api.example.com",
    VITE_WEB_URL: "https://app.example.com",
  },
}))

describe("UnifiedDiscoverForm", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  // The server follows web addresses and RSSHub routes only
  test("does not offer to preview an app link", async () => {
    const router = createMemoryRouter([{ path: "/", element: <UnifiedDiscoverForm /> }], {
      initialEntries: [`/?url=${encodeURIComponent("yanrr://add?id=1")}`],
    })
    const host = document.createElement("div")
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={jotaiStore}>
            <RouterProvider router={router} />
          </Provider>
        </QueryClientProvider>,
      )
    })

    const submit = host.querySelector<HTMLButtonElement>('[data-testid="discover-form-submit"]')
    expect(submit?.disabled).toBe(true)
    await act(async () => {
      root.unmount()
    })
  })
})
