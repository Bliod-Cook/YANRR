import { describe, expect, it } from "vitest"

import { isUserHeaderGradientLight } from "./layout"

describe("isUserHeaderGradientLight", () => {
  it.each([
    { expected: false, imageColors: undefined, scenario: "missing image colors" },
    { expected: false, imageColors: { platform: "web" as const }, scenario: "web colors" },
    {
      expected: false,
      imageColors: { dominant: "#110000", platform: "android" as const },
      scenario: "dark Android colors",
    },
    {
      expected: true,
      imageColors: { platform: "ios" as const, primary: "#f5f5f5" },
      scenario: "light iOS colors",
    },
  ])("returns $expected for $scenario", ({ expected, imageColors }) => {
    expect(isUserHeaderGradientLight(imageColors)).toBe(expected)
  })
})
