import type { EntryModel } from "@follow/store/entry/types"
import { describe, expect, it } from "vitest"

import { countEntriesByDate } from "./group-counts"

const entry = (publishedAt: string, url = "https://example.com") =>
  ({ publishedAt, url }) as unknown as EntryModel

describe("countEntriesByDate", () => {
  it("counts the consecutive entries of a day", () => {
    const entries = {
      a: entry("2026-11-10T10:00:00Z"),
      b: entry("2026-11-10T09:00:00Z"),
      c: entry("2026-11-08T09:00:00Z"),
    }
    expect(countEntriesByDate(["a", "b", "c"], entries)).toEqual([2, 1])
  })

  it("keeps an entry missing from the store in the group, so the counts add up to the rows", () => {
    const entries = {
      a: entry("2026-11-10T10:00:00Z"),
      c: entry("2026-11-08T09:00:00Z"),
    }
    expect(countEntriesByDate(["a", "missing", "c"], entries)).toEqual([2, 1])
    expect(countEntriesByDate(["missing", "a"], entries)).toEqual([1, 1])
  })
})
