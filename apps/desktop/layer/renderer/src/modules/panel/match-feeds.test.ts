import { describe, expect, it } from "vitest"

import { matchFeeds } from "./match-feeds"

const feeds = [
  { id: "a", names: ["The Rust Blog"], addresses: ["https://blog.rust-lang.org/feed.xml"] },
  {
    id: "b",
    names: ["My reading", "Rustacean Station"],
    addresses: ["https://rustacean-station.org"],
  },
  { id: "c", names: ["Go News"], addresses: ["https://go.dev/blog/feed.atom"] },
  { id: "d", names: ["Weekly"], addresses: ["https://this-week-in-RUST.org/rss.xml"] },
]

describe("matchFeeds", () => {
  it("finds the keyword in any name or address, names starting with it first", () => {
    expect(matchFeeds("rust", feeds).map((feed) => feed.id)).toEqual(["b", "a", "d"])
  })

  it("finds nothing for a keyword in no feed", () => {
    expect(matchFeeds("python", feeds)).toEqual([])
  })
})
