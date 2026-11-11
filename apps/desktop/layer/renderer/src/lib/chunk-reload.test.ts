import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { clearChunkReloadMarker, installChunkReloadHandler } from "./chunk-reload"

const dispatchPreloadError = () => {
  const event = new Event("vite:preloadError", { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe("chunk reload", () => {
  const reload = vi.fn()

  beforeEach(() => {
    sessionStorage.clear()
    reload.mockClear()
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location)
    installChunkReloadHandler()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("reloads on every preload error until one start succeeds", () => {
    expect(dispatchPreloadError().defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)

    // The reloaded page fails again: no loop
    dispatchPreloadError()
    expect(reload).toHaveBeenCalledTimes(1)

    // The reloaded page started fine, so a later deployment may reload again
    clearChunkReloadMarker()
    dispatchPreloadError()
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
