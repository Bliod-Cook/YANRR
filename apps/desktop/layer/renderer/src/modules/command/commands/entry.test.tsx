import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

import { getShowAISummaryOnce } from "~/atoms/ai-summary"
import { getShowAITranslationOnce } from "~/atoms/ai-translation"
import { setServerConfigs } from "~/atoms/server-configs"

import { getCommand } from "../hooks/use-command"
import { useRegisterEntryCommands } from "./entry"
import { COMMAND_ID } from "./id"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))

const Probe = () => {
  useRegisterEntryCommands()
  return null
}

describe("useRegisterEntryCommands", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(async () => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <Probe />
        </QueryClientProvider>,
      )
    })
  })

  afterAll(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
  })

  test("offers no AI summary or translation toggle when the server has no AI", async () => {
    await act(async () => setServerConfigs({ ai: false, push: false, registration: false }))

    expect(getCommand(COMMAND_ID.entry.toggleAISummary)).toBeNull()
    expect(getCommand(COMMAND_ID.entry.toggleAITranslation)).toBeNull()
  })

  // The entry toolbar hides the actions of unregistered commands
  test("registers the AI summary and translation toggles when the server has AI", async () => {
    await act(async () => setServerConfigs({ ai: true, push: false, registration: false }))

    getCommand(COMMAND_ID.entry.toggleAISummary)?.run()
    getCommand(COMMAND_ID.entry.toggleAITranslation)?.run()

    expect(getShowAISummaryOnce()).toBe(true)
    expect(getShowAITranslationOnce()).toBe(true)
  })
})
