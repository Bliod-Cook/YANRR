import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@follow/shared/constants", () => ({ APP_PROTOCOL: "yanrr" }))

describe("deep link queue", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("holds links until the renderer is ready, then opens them in order", async () => {
    const { openDeepLink, setDeepLinkHandler, setRendererReady } = await import("./deep-link")
    const handler = vi.fn()

    openDeepLink("yanrr://add?id=1")
    setDeepLinkHandler(handler)
    openDeepLink("yanrr://add?id=2")
    expect(handler).not.toHaveBeenCalled()

    setRendererReady(true)
    expect(handler.mock.calls).toEqual([["yanrr://add?id=1"], ["yanrr://add?id=2"]])

    openDeepLink("yanrr://add?id=3")
    expect(handler).toHaveBeenLastCalledWith("yanrr://add?id=3")
  })

  it("holds links again while the renderer reloads", async () => {
    const { openDeepLink, setDeepLinkHandler, setRendererReady } = await import("./deep-link")
    const handler = vi.fn()
    setDeepLinkHandler(handler)
    setRendererReady(true)

    setRendererReady(false)
    openDeepLink("yanrr://feed?id=1")
    expect(handler).not.toHaveBeenCalled()

    setRendererReady(true)
    expect(handler).toHaveBeenCalledWith("yanrr://feed?id=1")
  })

  it("recognizes the app protocol among launch arguments", async () => {
    const { isDeepLink } = await import("./deep-link")

    expect(isDeepLink("yanrr://add?id=1")).toBe(true)
    expect(isDeepLink("--start-in-tray")).toBe(false)
    expect(isDeepLink("/Applications/Yanrr.app")).toBe(false)
  })
})
