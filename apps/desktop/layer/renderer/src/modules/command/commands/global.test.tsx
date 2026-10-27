import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"

import { getCommand } from "../hooks/use-command"
import { useRegisterGlobalCommands } from "./global"
import { COMMAND_ID } from "./id"

vi.mock("~/modules/modal/hooks/useShortcutsModal", () => ({
  useShortcutsModal: () => vi.fn(),
}))

const GlobalCommands = () => {
  useRegisterGlobalCommands()
  return null
}

describe("useRegisterGlobalCommands", () => {
  let root: Root | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
  })

  const render = async () => {
    root = createRoot(document.createElement("div"))
    await act(async () => root?.render(<GlobalCommands />))
  }

  test("has no AI chat command while the server has AI off", async () => {
    setServerConfigs({} as never)
    await render()

    expect(getCommand(COMMAND_ID.global.quickSearch)).not.toBeNull()
    expect(getCommand(COMMAND_ID.global.toggleAIChat)).toBeNull()
  })

  test("adds the AI chat command once the server has AI", async () => {
    setServerConfigs({ AI_CHAT_ENABLED: true } as never)
    await render()

    expect(getCommand(COMMAND_ID.global.toggleAIChat)).not.toBeNull()
  })
})
