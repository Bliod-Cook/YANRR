import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { Media } from "./Media"

describe("Media video hover", () => {
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
    vi.restoreAllMocks()
  })

  const hover = async (target: Element, type: "mouseover" | "mouseout") => {
    await act(async () => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: null }))
    })
  }

  test("plays on the first hover over a preview image and pauses on leave", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <Media type="video" src="https://example.com/a.mp4" previewImageUrl="/poster.jpg" />,
      )
    })

    expect(container.querySelector("video")).toBeNull()
    const wrapper = container.querySelector("img")!.parentElement!

    await hover(wrapper, "mouseover")
    expect(container.querySelector("video")).not.toBeNull()
    expect(play).toHaveBeenCalledTimes(1)

    await hover(wrapper, "mouseout")
    expect(pause).toHaveBeenCalled()
  })
})
