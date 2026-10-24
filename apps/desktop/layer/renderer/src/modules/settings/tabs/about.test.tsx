import { LICENSE_URL, SOURCE_CODE_URL } from "@follow/constants"
import settingsEn from "@locales/settings/en.json"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import i18next from "i18next"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { expect, test, vi } from "vitest"

import { SettingAbout } from "./about"

vi.mock("@follow/shared/env.desktop", () => ({
  env: { VITE_API_URL: "https://api.example.com" },
}))

test("credits Folo and offers the license and source code", async () => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { settings: settingsEn } },
    interpolation: { escapeValue: false },
  })

  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <SettingAbout />
        </QueryClientProvider>
      </I18nextProvider>,
    )
  })

  const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))
  expect(container.textContent).toContain("Folo Team")
  expect(hrefs).toEqual(expect.arrayContaining([SOURCE_CODE_URL, LICENSE_URL]))

  act(() => root.unmount())
  container.remove()
})
