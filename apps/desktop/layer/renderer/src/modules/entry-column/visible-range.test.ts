import type { Range } from "@tanstack/react-virtual"
import { describe, expect, it } from "vitest"

import { gridVisibleRange, listVisibleRange } from "./visible-range"

// Virtualizers report the last visible row inclusively
const rows = (startIndex: number, endIndex: number) => ({ startIndex, endIndex })
const ids = Array.from({ length: 10 }, (_, index) => `entry${index}`)
const visible = ({ startIndex, endIndex }: Pick<Range, "startIndex" | "endIndex">) =>
  ids.slice(startIndex, endIndex)

describe("visible entry ranges", () => {
  it("covers every entry of the visible grid rows, the last one included", () => {
    expect(visible(gridVisibleRange(rows(0, 0), 4, 10))).toEqual(ids.slice(0, 4))
    expect(visible(gridVisibleRange(rows(0, 1), 4, 10))).toEqual(ids.slice(0, 8))
    // The last row is not full
    expect(visible(gridVisibleRange(rows(1, 2), 4, 10))).toEqual(ids.slice(4, 10))
  })

  it("covers the last visible item of a list", () => {
    expect(visible(listVisibleRange(rows(2, 5)))).toEqual(ids.slice(2, 6))
  })
})
