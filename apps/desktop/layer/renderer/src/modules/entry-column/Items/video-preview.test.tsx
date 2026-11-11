import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { VideoPreview } from "./video-preview"

describe("VideoPreview", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    host?.remove()
  })

  const render = async (src: string) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(<VideoPreview src={src} />))
    return host
  }

  it("loads an http(s) page in a sandboxed frame", async () => {
    const frame = (await render("http://localhost:1/embed/1")).querySelector("iframe")
    expect(frame?.getAttribute("src")).toBe("http://localhost:1/embed/1")
    expect(frame?.hasAttribute("sandbox")).toBe(true)
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-top-navigation")
  })

  it.each(["javascript:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd", "x"])(
    "does not load %s",
    async (src) => {
      expect((await render(src)).children).toHaveLength(0)
    },
  )
})
