import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"

import { PlainModal } from "./custom-modal"
import { useModalStack } from "./hooks"
import { ModalStackProvider } from "./provider"

let stack: ReturnType<typeof useModalStack>
const CaptureStack = () => {
  stack = useModalStack()
  return null
}

describe("modal close", () => {
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

  test("closing twice calls onClose once", async () => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <Provider store={jotaiStore}>
          <GlobalFocusableProvider>
            <ModalStackProvider>
              <CaptureStack />
            </ModalStackProvider>
          </GlobalFocusableProvider>
        </Provider>,
      )
    })

    const onClose = vi.fn()
    await act(async () => {
      stack.present({
        id: "m",
        title: "Modal",
        content: () => <div>body</div>,
        CustomModalComponent: PlainModal,
        onClose,
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(stack.getModalStackById("m")).toBeDefined()

    await act(async () => {
      stack.dismiss("m")
      stack.dismiss("m")
      await new Promise((resolve) => setTimeout(resolve, 1000))
    })

    expect(stack.getModalStackById("m")).toBeUndefined()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
