import { describe, expect, it } from "vitest"

import { collectEntriesScrolledPast } from "./scrolled-past"

/** Feeds the reports of visible entries to the collector in order, as the list makes them */
const replay = (reports: { visible: string[]; entryIds: string[]; pastEnd?: boolean }[]) => {
  let seen: ReadonlySet<string> = new Set()
  return reports.map((report) => {
    const result = collectEntriesScrolledPast({ seen, ...report })
    seen = result.seen
    return result.scrolledPast
  })
}

const list = ["a", "b", "c", "d", "e", "f", "g"]

describe("collectEntriesScrolledPast", () => {
  it("collects the entries that went above the screen while scrolling down", () => {
    expect(
      replay([
        { visible: ["b", "c", "d"], entryIds: list },
        { visible: ["c", "d", "e"], entryIds: list },
        { visible: ["e", "f", "g"], entryIds: list },
      ]),
    ).toEqual([[], ["b"], ["c", "d"]])
  })

  it("leaves the entries that went below the screen while scrolling up", () => {
    expect(
      replay([
        { visible: ["c", "d", "e"], entryIds: list },
        { visible: ["b", "c", "d"], entryIds: list },
        { visible: ["a", "b", "c"], entryIds: list },
      ]),
    ).toEqual([[], [], []])
  })

  it("never collects an unseen entry when a read one leaves an unread-only list", () => {
    const withoutB = list.filter((id) => id !== "b")
    expect(
      replay([
        { visible: ["b", "c", "d"], entryIds: list },
        { visible: ["c", "d", "e"], entryIds: list },
        // `b` was marked read and left the list; the entries on screen stay where they were
        { visible: ["c", "d", "e"], entryIds: withoutB },
        // or the list reports the same positions, which now hold the entries one further down
        { visible: ["d", "e", "f"], entryIds: withoutB },
      ]),
    ).toEqual([[], ["b"], [], ["c"]])
  })

  it("collects nothing when new entries are merged in at the head", () => {
    const merged = ["x", "y", ...list]
    expect(
      replay([
        { visible: ["c", "d", "e"], entryIds: list },
        // The list keeps the entries on screen in place
        { visible: ["c", "d", "e"], entryIds: merged },
        { visible: ["c", "d", "e", "f"], entryIds: merged },
      ]),
    ).toEqual([[], [], []])
    expect(
      replay([
        { visible: ["c", "d", "e"], entryIds: list },
        // A list resting at its top scrolls up to the new entries instead
        { visible: ["x", "y", "a"], entryIds: merged },
      ]),
    ).toEqual([[], []])
  })

  it("collects an entry that left the top of its column once the other column passes it", () => {
    expect(
      replay([
        { visible: ["a", "b"], entryIds: list },
        // In a masonry layout `b` leaves while `a`, earlier but taller, is still on screen
        { visible: ["a", "c"], entryIds: list },
        { visible: ["c", "d"], entryIds: list },
      ]),
    ).toEqual([[], [], ["a", "b"]])
  })

  it("collects the last entries once only the end of the list is on screen", () => {
    expect(
      replay([
        { visible: ["f", "g"], entryIds: list },
        { visible: [], entryIds: list },
        { visible: [], entryIds: list, pastEnd: true },
      ]),
    ).toEqual([[], [], ["f", "g"]])
  })
})
