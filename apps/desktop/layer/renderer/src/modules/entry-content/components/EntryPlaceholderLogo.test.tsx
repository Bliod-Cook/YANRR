import appEn from "@locales/app/en.json"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"

import { EntryPlaceholderLogo } from "./EntryPlaceholderLogo"

const { hasShortcut } = vi.hoisted(() => ({ hasShortcut: vi.fn(() => false) }))

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: keyof typeof appEn) => appEn[key] ?? key }),
  }
})

vi.mock("~/modules/ai-chat/hooks/useSendAIShortcut", () => ({
  useSendAIShortcut: () => ({ sendAIShortcut: vi.fn(), hasShortcut }),
}))

vi.mock("~/modules/settings/modal/use-setting-modal-hack", () => ({
  useSettingModal: () => vi.fn(),
}))

describe("EntryPlaceholderLogo", () => {
  let root: Root | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    document.body.innerHTML = ""
  })

  const render = async () => {
    const host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(<EntryPlaceholderLogo />))
    return [...host.querySelectorAll("button")].map((button) => button.textContent)
  }

  test("offers no AI actions while the server has AI off", async () => {
    setServerConfigs({} as never)

    expect(await render()).toEqual([])
  })

  test("leaves out shortcut actions with no shortcut to run", async () => {
    setServerConfigs({ AI_CHAT_ENABLED: true } as never)

    expect(await render()).toEqual([
      appEn["entry_content.placeholder.sort_timeline"],
      appEn["entry_content.placeholder.personalize_ai"],
    ])
  })
})
