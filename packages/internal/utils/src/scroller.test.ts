import { describe, expect, it } from "vitest"

import { springScrollToElement } from "./scroller"

describe("springScrollToElement", () => {
  it("lands on an element that moved while scrolling", async () => {
    const scroller = document.createElement("div")
    const heading = document.createElement("h2")
    scroller.append(heading)
    // happy-dom lays nothing out, so the heading's position is set by hand
    let top = 500
    Object.defineProperty(heading, "offsetTop", { get: () => top })

    const animation = springScrollToElement(heading, -100, scroller)
    // An image above the heading loads and pushes it down
    top = 800
    animation.complete()
    await animation

    expect(scroller.scrollTop).toBe(700)
  })
})
