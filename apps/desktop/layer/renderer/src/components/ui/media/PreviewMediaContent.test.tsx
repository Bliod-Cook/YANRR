import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { CurrentModalContext } from "../modal/stacked/context"
import { PreviewMediaContent } from "./PreviewMediaContent"

describe("PreviewMediaContent", () => {
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

  const renderPreview = async () => {
    const dismiss = vi.fn()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <CurrentModalContext
          value={{
            dismiss,
            setClickOutSideToDismiss: () => {},
            setHasUnsavedChanges: () => {},
            ref: { current: null },
            modalElementRef: { current: null },
            getIndex: () => 0,
          }}
        >
          <PreviewMediaContent media={[{ url: "https://example.com/photo.jpg", type: "photo" }]} />
        </CurrentModalContext>,
      )
    })
    const image = container.querySelector("img")!
    // The zoomable stage around the image, which takes the clicks that miss it
    const stage = container.querySelector(".react-transform-component")!
    return { dismiss, image, stage }
  }

  const press = async (target: Element) => {
    await act(async () => {
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    })
  }
  const click = async (target: Element) => {
    await act(async () => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    })
  }

  test("fits a small image to a share of the screen", async () => {
    const { image } = await renderPreview()

    Object.defineProperties(image, { naturalWidth: { value: 300 }, naturalHeight: { value: 200 } })
    await act(async () => {
      image.dispatchEvent(new Event("load"))
    })

    // 85% of the screen's width, or of its height for a screen wider than the image
    expect(image.style.width).toBe("85vw")
    expect(image.style.maxWidth).toBe("127.5vh")
  })

  test("closes on a click beside the image", async () => {
    const { dismiss, stage } = await renderPreview()

    await press(stage)
    await click(stage)

    expect(dismiss).toHaveBeenCalledOnce()
  })

  test("stays open when a press on the image is released beside it", async () => {
    const { dismiss, image, stage } = await renderPreview()

    // Panning a zoomed image and letting go off the image clicks the stage
    await press(image)
    await click(stage)

    expect(dismiss).not.toHaveBeenCalled()
  })
})
