import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { CopyButton } from "./CopyButton"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe("CopyButton", () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
  })

  const clickCopy = async (writeText: () => Promise<void>) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<CopyButton value="text" />))
    await act(async () => container!.querySelector("button")!.click())
    return container
  }

  test("shows the check mark after a successful copy", async () => {
    const view = await clickCopy(() => Promise.resolve())
    expect(view.querySelector(".i-mgc-check-filled")).not.toBeNull()
  })

  test("keeps the copy icon when the clipboard is unavailable", async () => {
    const view = await clickCopy(() => Promise.reject(new Error("denied")))
    expect(view.querySelector(".i-mgc-check-filled")).toBeNull()
  })
})
