import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { ActionButton } from "@follow/components/ui/button/action-button.js"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

describe("ActionButton", () => {
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

  const render = async (button: React.ReactElement) => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<GlobalFocusableProvider>{button}</GlobalFocusableProvider>))
    return container.querySelector("button")!
  }

  // The command system binds the keys, so a rebound command does not keep the old one
  test("leaves its shortcut to the command system", async () => {
    const onClick = vi.fn()
    await render(<ActionButton shortcut="U" onClick={onClick} />)

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "u", code: "KeyU", bubbles: true, cancelable: true }),
      )
    })

    expect(onClick).not.toHaveBeenCalled()
  })

  test("shows the loading state only for a click handler that returns a promise", async () => {
    let pending: Promise<void> | undefined
    const button = await render(<ActionButton onClick={() => pending} />)
    const busyChanges: MutationRecord[] = []
    const observer = new MutationObserver((records) => busyChanges.push(...records))
    observer.observe(button, { attributes: true, attributeFilter: ["aria-busy"] })

    await act(async () => button.click())
    busyChanges.push(...observer.takeRecords())
    observer.disconnect()
    expect(busyChanges).toEqual([])

    let finish = () => {}
    pending = new Promise((resolve) => (finish = resolve))
    await act(async () => button.click())
    expect(button.getAttribute("aria-busy")).toBe("true")
    await act(async () => finish())
    expect(button.getAttribute("aria-busy")).toBeNull()
  })
})
