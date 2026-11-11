import settingsEn from "@locales/settings/en.json"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"

import { SettingNotifications } from "./notifications"

vi.mock("@follow/shared/env.desktop", () => ({
  env: { VITE_API_URL: "https://api.example.com", VITE_WEB_URL: "https://app.example.com" },
}))
vi.mock("~/components/ui/modal/stacked/hooks", () => ({
  useCurrentModal: () => ({ dismiss: vi.fn() }),
}))
vi.mock("~/queries/messaging", () => ({
  useMessaging: () => ({ isLoading: false, data: { data: [] } }),
  useTestMessaging: () => ({ mutate: vi.fn() }),
}))
vi.mock("~/hooks/common", () => ({
  useI18n: () => ({
    settings: (key: keyof typeof settingsEn) => settingsEn[key],
    common: (key: string) => key,
  }),
}))

describe("SettingNotifications", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => setServerConfigs(null))

  const render = async (push: boolean) => {
    setServerConfigs({ ai: false, push, registration: false })
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <SettingNotifications />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    )
    const text = host.textContent
    await act(async () => root.unmount())
    return text
  }

  test("lists the channels on a server with push, and says it has none otherwise", async () => {
    expect(await render(true)).toContain(settingsEn["notifications.channel"])

    const without = await render(false)
    expect(without).toContain(settingsEn["notifications.not_configured"])
    expect(without).not.toContain(settingsEn["notifications.channel"])
  })
})
