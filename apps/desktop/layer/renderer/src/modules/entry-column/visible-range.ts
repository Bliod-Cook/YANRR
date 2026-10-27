import type { Range } from "@tanstack/react-virtual"

type Indexes = Pick<Range, "startIndex" | "endIndex">

// Virtualizers report their last visible item inclusively; the entry ranges here end after it,
// as `slice` does, which is how marking entries read takes them.

export const listVisibleRange = ({ startIndex, endIndex }: Indexes): Indexes => ({
  startIndex,
  endIndex: endIndex + 1,
})

/** The entries of the visible rows of a grid with `columnCount` entries per row */
export const gridVisibleRange = (
  { startIndex, endIndex }: Indexes,
  columnCount: number,
  entryCount: number,
): Indexes => ({
  startIndex: startIndex * columnCount,
  endIndex: Math.min(entryCount, (endIndex + 1) * columnCount),
})
