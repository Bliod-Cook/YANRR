import { MotionProvider } from "@follow/components/common/MotionProvider.jsx"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { FeedIcon } from "./feed-icon"

let root: Root
let container: HTMLDivElement

beforeAll(() => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

test("keeps a loaded icon visible when rerendered during its fade-in", async () => {
  // happy-dom does not load images; keep the real Radix and Motion components.
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true)
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(58)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)

  const render = () =>
    root.render(
      <MotionProvider>
        <FeedIcon
          target={{ type: "feed", image: "https://example.com/cover.png" }}
          fallback={false}
        />
      </MotionProvider>,
    )

  await act(async () => render())
  const image = container.querySelector("img")!
  expect(image).not.toBeNull()
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  const animation = image.getAnimations()[0]!
  expect(animation.playState).toBe("running")
  // happy-dom eagerly creates a finished promise, which rejects when Motion cancels it.
  void animation.finished.catch(() => {})
  await act(async () => render())

  await act(async () => {
    await expect.poll(() => getComputedStyle(image).opacity).toBe("1")
  })
})
