import { MotionProvider } from "@follow/components/common/MotionProvider.jsx"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { FeedIcon } from "./feed-icon"

let root: Root
let container: HTMLDivElement

// happy-dom returns an empty string for the default opacity of 1.
const getOpacity = (image: HTMLImageElement) => getComputedStyle(image).opacity || "1"

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
  // happy-dom eagerly creates a finished promise, which rejects when Motion cancels it.
  for (const animation of image.getAnimations()) void animation.finished.catch(() => {})
  await act(async () => render())

  await act(async () => {
    await expect.poll(() => getOpacity(image)).toBe("1")
  })
})

test("keeps the first batch of author avatars visible after their fade-in is interrupted", async () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true)
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(58)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)

  const avatar = (index: number) => (
    <FeedIcon
      key={index}
      target={{ type: "feed", title: "Author", image: "https://example.com/author.png" }}
      size={18}
      noMargin
    />
  )
  // Reuse the first batch's elements, as a virtualized list need not rerender earlier rows.
  const firstBatch = Array.from({ length: 16 }, (_, index) => avatar(index))
  const render = (icons: React.ReactNode) => root.render(<MotionProvider>{icons}</MotionProvider>)

  await act(async () => render(firstBatch))
  expect(container.querySelectorAll("img")).toHaveLength(16)
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    for (const image of container.querySelectorAll("img")) {
      for (const animation of image.getAnimations()) {
        void animation.finished.catch(() => {})
        animation.cancel()
      }
    }
  })

  await act(async () => render([...firstBatch, avatar(16)]))
  const images = Array.from(container.querySelectorAll("img"))
  expect(images).toHaveLength(17)
  expect(getOpacity(images[16]!)).toBe("1")
  await act(async () => {
    await expect.poll(() => images.map(getOpacity)).toEqual(Array.from({ length: 17 }, () => "1"))
  })
})
