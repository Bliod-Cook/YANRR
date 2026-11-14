import { describe, expect, test } from "vitest"

import { doesTextContainHTML, isBizId, omitShallow, timeStringToSeconds } from "./utils"

describe("utils", () => {
  test("isBizId", () => {
    expect(isBizId("1712546615000")).toBe(true)
    expect(isBizId("17125466150000")).toBe(true)
    expect(isBizId("171254661500000")).toBe(true)
    expect(isBizId("1712546615000000")).toBe(true)
    expect(isBizId("17125466150000000")).toBe(true)
    expect(isBizId("171254661500000000")).toBe(true)
    expect(isBizId("1712546615000000000")).toBe(true)
    expect(isBizId("9994780527253199722")).toBe(false)

    // sample biz id
    expect(isBizId("41147805272531997")).toBe(true)

    // test string
    expect(isBizId("ep 1712546615000")).toBe(false)
    expect(isBizId("又有人在微博提到 RSSHub 了")).toBe(false)

    // test short number
    expect(isBizId("123456789")).toBe(false)

    // test long number
    expect(isBizId("12345678901234567890")).toBe(false)
  })

  test("omitShallow", () => {
    expect(omitShallow({ a: 1, b: 2, c: 3 }, "a", "b")).toEqual({ c: 3 })
    expect(omitShallow(null)).toEqual(null)
    expect(omitShallow(void 0)).toEqual(void 0)
    expect(omitShallow([1, 2])).toEqual([1, 2])
  })

  test("does text contain html", () => {
    expect(doesTextContainHTML("a<div>b</div>")).toBe(true)
    expect(doesTextContainHTML("Test")).toBe(false)
    expect(doesTextContainHTML("<p> </p>")).toBe(false)
    expect(doesTextContainHTML("Test <p> </p>")).toBe(false)
    expect(doesTextContainHTML("Test <br/>")).toBe(false)
  })

  test("timeStringToSeconds counts minutes past an hour", () => {
    expect(timeStringToSeconds("123:45")).toBe(7425)
    expect(timeStringToSeconds("2:03:45")).toBe(7425)
    expect(timeStringToSeconds("1:60")).toBeNull()
    expect(timeStringToSeconds("Part 2: The end")).toBeNull()
  })
})
