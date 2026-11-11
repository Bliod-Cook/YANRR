import { createMemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { exposeHistoryIsPop } from "./history"

describe("history.isPop", () => {
  it("tells a step back from a new page for as long as the page is shown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    try {
      const router = createMemoryRouter([{ path: "*", element: null }], {
        initialEntries: ["/timeline"],
      })
      exposeHistoryIsPop(router)

      await router.navigate("/discover")
      expect(history.isPop).toBe(false)

      void router.navigate(-1)
      await vi.waitFor(() => expect(router.state.location.pathname).toBe("/timeline"))
      // A page whose code loads slowly reads it late
      vi.advanceTimersByTime(5000)
      expect(history.isPop).toBe(true)

      await router.navigate("/settings")
      expect(history.isPop).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
