import { describe, expect, it } from "vitest"

import { getTranslationPrefetchIds } from "./translation-prefetch"

describe("getTranslationPrefetchIds", () => {
  const visibleIds = ["a", "b"]

  it("prefetches the visible entries of an active list on a server with AI", () => {
    expect(getTranslationPrefetchIds({ visibleIds, active: true, aiEnabled: true })).toEqual(
      visibleIds,
    )
  })

  it("prefetches nothing when the server has no AI, as it answers such requests with 403", () => {
    expect(getTranslationPrefetchIds({ visibleIds, active: true, aiEnabled: false })).toEqual([])
  })

  it("prefetches nothing for an inactive list", () => {
    expect(getTranslationPrefetchIds({ visibleIds, active: false, aiEnabled: true })).toEqual([])
  })
})
