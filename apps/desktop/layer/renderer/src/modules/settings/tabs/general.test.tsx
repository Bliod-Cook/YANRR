import settingsEn from "@locales/settings/en.json"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"
import { jotaiStore } from "~/lib/jotai"

import { SettingGeneral } from "./general"

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>()
  return {
    ...actual,
    useTranslation: () => ({
      i18n: { language: "en" },
      t: (key: keyof typeof settingsEn) => settingsEn[key] ?? key,
    }),
  }
})

// Defined by the build
vi.stubGlobal("I18N_COMPLETENESS_MAP", {})

describe("SettingGeneral", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => setServerConfigs(null))

  const render = async (ai: boolean) => {
    setServerConfigs({ ai, push: false, registration: false })
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <Provider store={jotaiStore}>
          <SettingGeneral />
        </Provider>,
      ),
    )
    const text = host.textContent
    await act(async () => root.unmount())
    return text
  }

  test("offers the summary and translation settings only on a server with AI", async () => {
    const summary = settingsEn["general.action.summary.label"]
    const translationMode = settingsEn["general.translation_mode.label"]

    const withAi = await render(true)
    expect(withAi).toContain(summary)
    expect(withAi).toContain(translationMode)

    const withoutAi = await render(false)
    expect(withoutAi).not.toContain(summary)
    expect(withoutAi).not.toContain(translationMode)
    expect(withoutAi).toContain(settingsEn["general.subscription"])
  })
})
