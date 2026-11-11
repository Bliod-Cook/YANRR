import { describe, expect, test } from "vitest"

import { generateExportFilename } from "./utils"

describe("generateExportFilename", () => {
  test("uses the local date and time", () => {
    // Just after local midnight, when the UTC date can still be the previous day
    expect(generateExportFilename(new Date(2026, 9, 12, 0, 30, 5))).toBe(
      "yanrr-actions-2026-10-12-00-30-05.json",
    )
  })
})
