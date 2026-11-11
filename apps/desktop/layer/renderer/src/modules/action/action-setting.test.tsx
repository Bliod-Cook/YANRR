import { useActionStore } from "@follow/store/action/store"
import { apiContext } from "@follow/store/context"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"

import { SubViewHeaderActions } from "../app-layout/subview/HeaderActions"
import { ActionSetting } from "./action-setting"

vi.mock("@follow/shared/env.desktop", () => ({
  env: {
    VITE_API_URL: "https://api.example.com",
    VITE_WEB_URL: "https://app.example.com",
  },
}))

const LOADED_AT = "2026-10-13T08:00:00.000Z"

describe("ActionSetting", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  const getRules = vi.fn()
  const putRules = vi.fn()

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(async () => {
    useActionStore.setState({ rules: [], isDirty: false, isLoaded: false })
    setServerConfigs(null)
    getRules.mockReset()
    putRules.mockReset()
    apiContext.provide({ actions: { get: getRules, put: putRules } } as unknown as Parameters<
      typeof apiContext.provide
    >[0])
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    root = null
    host = null
  })

  const render = async () => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <>
            <SubViewHeaderActions isHeaderElevated />
            <ActionSetting />
          </>
        ),
      },
    ])
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )
    })
  }

  const button = (label: string) =>
    [...host!.querySelectorAll("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
    )

  test("saves the deletion of the last rule like any other edit", async () => {
    getRules.mockResolvedValue({
      code: 0,
      data: {
        rules: [{ name: "Only", condition: [], result: { star: true } }],
        updatedAt: LOADED_AT,
      },
    })
    putRules.mockResolvedValue({ code: 0, updatedAt: "2026-10-13T09:00:00.000Z" })
    await render()
    await vi.waitFor(() => expect(button("actions.action_card.summary.delete")).toBeDefined())

    await act(async () => {
      button("actions.action_card.summary.delete")!.click()
    })
    expect(putRules).not.toHaveBeenCalled()

    await act(async () => {
      button("actions.save")!.click()
    })
    await vi.waitFor(() =>
      expect(putRules).toHaveBeenCalledWith({ rules: [], expectedUpdatedAt: LOADED_AT }),
    )
  })

  test("offers the summary and translation actions only on a server with AI", async () => {
    getRules.mockResolvedValue({
      code: 0,
      data: {
        rules: [{ name: "Only", condition: [], result: { star: true, summary: true } }],
        updatedAt: LOADED_AT,
      },
    })
    // The rule card lists what the rule does; the editor offers the action
    const hasSummaryAction = () =>
      [...host!.querySelectorAll("span")].some(
        (element) => element.textContent === "actions.action_card.generate_summary",
      )
    const rules = (ai: boolean) => {
      setServerConfigs({ ai, push: false, registration: false })
      return render()
    }

    await rules(false)
    await vi.waitFor(() => expect(button("actions.action_card.summary.delete")).toBeDefined())
    expect(hasSummaryAction()).toBe(false)
    await act(async () => root!.unmount())
    host!.remove()

    await rules(true)
    await vi.waitFor(() => expect(hasSummaryAction()).toBe(true))
  })
})
