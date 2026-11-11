import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../db"
import { collectionsTable, entriesTable, subscriptionsTable } from "../schemas"
import { EntryService } from "./entry"

vi.mock("../db", async () => (await import("../test-db")).createTestDB())

/** Entry `index` of a feed, newer for a lower index */
const entry = (feedId: string, index: number) => ({
  id: `${feedId}-${index}`,
  guid: `${feedId}-${index}`,
  feedId,
  insertedAt: new Date(2026, 0, 1),
  publishedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000),
})

const follow = (feedId: string) => ({
  id: feedId,
  feedId,
  userId: "me",
  view: 0,
  isPrivate: false,
  type: "feed" as const,
})

const keptIds = async () => (await EntryService.getEntriesToHydrate()).map((kept) => kept.id)

describe("EntryService.getEntriesToHydrate", () => {
  beforeEach(async () => {
    await db.delete(entriesTable)
    await db.delete(collectionsTable)
    await db.delete(subscriptionsTable)
  })

  it("keeps the newest 20 entries of a feed and the older ones that are starred", async () => {
    await db.insert(subscriptionsTable).values(follow("feed"))
    await db
      .insert(entriesTable)
      .values(Array.from({ length: 25 }, (_, index) => entry("feed", index)))
    await db.insert(collectionsTable).values({ entryId: "feed-23", feedId: "feed", view: 0 })

    const kept = await keptIds()

    expect(kept).toHaveLength(21)
    expect(kept).toContain("feed-23")
    expect(kept).not.toContain("feed-24")
    const stored = await db.query.entriesTable.findMany({ columns: { id: true } })
    expect(stored.map((row) => row.id).sort()).toEqual([...kept].sort())
  })

  it("keeps the newest 20 entries of an inbox", async () => {
    await db
      .insert(subscriptionsTable)
      .values({ ...follow("news"), inboxId: "news", type: "inbox" })
    // An inbox entry has the handle as its feed id too
    await db
      .insert(entriesTable)
      .values(
        Array.from({ length: 25 }, (_, index) => ({
          ...entry("news", index),
          inboxHandle: "news",
        })),
      )

    expect(await keptIds()).toHaveLength(20)
  })

  it("keeps starred entries of feeds no longer followed", async () => {
    await db.insert(entriesTable).values([entry("unfollowed", 0), entry("unfollowed", 1)])
    await db.insert(collectionsTable).values({ entryId: "unfollowed-1", view: 0 })

    expect(await keptIds()).toEqual(["unfollowed-1"])
  })
})
