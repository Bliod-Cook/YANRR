import { describe, expect, it } from "vitest"

import { nextLayoutVersion } from "./layout-version"

const start = { entryIds: ["a", "b", "c"], version: 0 }

describe("nextLayoutVersion", () => {
  it("keeps the version when a page is appended or nothing changed", () => {
    expect(nextLayoutVersion(start, ["a", "b", "c", "d", "e"]).version).toBe(0)
    expect(nextLayoutVersion(start, ["a", "b", "c"])).toBe(start)
  })

  it("counts changes that move the entries on screen", () => {
    expect(nextLayoutVersion(start, ["new", "a", "b", "c"]).version).toBe(1)
    expect(nextLayoutVersion(start, ["a", "c"]).version).toBe(1)
    expect(nextLayoutVersion(start, ["b", "a", "c"]).version).toBe(1)
  })
})
