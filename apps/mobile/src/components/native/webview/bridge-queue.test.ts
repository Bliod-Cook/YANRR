import { describe, expect, it } from "vitest"

import { createBridgeQueue } from "./bridge-queue"

const setup = () => {
  const sent: string[] = []
  const queue = createBridgeQueue((type, payload) => sent.push(`${type}:${payload}`))
  return { queue, sent }
}

describe("createBridgeQueue", () => {
  it("holds settings until the page's bridge is ready, then sends the latest of each", () => {
    const { queue, sent } = setup()

    queue.dispatch("setRootFontSize", "16")
    queue.dispatch("setRootFontSize", "20")
    queue.dispatch("setReaderStyle", "{}")
    expect(sent).toEqual([])

    queue.ready()
    expect(sent).toEqual(["setRootFontSize:20", "setReaderStyle:{}"])
  })

  it("sends at once while the bridge is ready", () => {
    const { queue, sent } = setup()
    queue.ready()

    queue.dispatch("setNoMedia", "true")

    expect(sent).toEqual(["setNoMedia:true"])
  })

  it("holds settings again once the page is gone, until the next page is ready", () => {
    const { queue, sent } = setup()
    queue.ready()

    queue.reset()
    queue.dispatch("setEntry", "{}")
    expect(sent).toEqual([])

    queue.ready()
    expect(sent).toEqual(["setEntry:{}"])
  })

  it("sends the latest of each again when another page says it is ready", () => {
    const { queue, sent } = setup()
    queue.ready()
    queue.dispatch("setCodeTheme", "{}")
    queue.dispatch("setRootFontSize", "18")

    queue.ready()
    expect(sent).toEqual([
      "setCodeTheme:{}",
      "setRootFontSize:18",
      "setCodeTheme:{}",
      "setRootFontSize:18",
    ])
  })
})
