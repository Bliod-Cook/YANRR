import { describe, expect, it } from "vitest"

import { versionCodeOf } from "../app.config.base"

describe("versionCodeOf", () => {
  it("grows with every version, so a release installs over the one before", () => {
    const versions = ["0.1.9", "0.1.10", "0.1.99", "0.2.0", "0.99.99", "1.0.0"]
    const codes = versions.map(versionCodeOf)

    expect(codes).toEqual([...codes].sort((a, b) => a - b))
    expect(new Set(codes).size).toBe(versions.length)
  })

  it("refuses a minor or patch the code has no room for", () => {
    expect(() => versionCodeOf("0.1.100")).toThrow("0.1.100")
    expect(() => versionCodeOf("0.100.0")).toThrow("0.100.0")
  })
})
