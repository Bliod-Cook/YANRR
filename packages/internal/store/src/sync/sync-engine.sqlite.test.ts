import { db } from "@follow/database/db"
import { EntryService } from "@follow/database/services/entry"
import { SyncMetaService } from "@follow/database/services/sync-meta"
import { describe, expect, it, vi } from "vitest"

import { apiContext, syncApiContext } from "../context"
import { useEntryStore } from "../modules/entry/store"
import type { EntryModel } from "../modules/entry/types"
import { useUserStore } from "../modules/user/store"
import type { FollowAPI } from "../types"
import { clearAccountInSession, startSessionCheck } from "./account"
import { syncEngine } from "./sync-engine"
import type { SyncAction, SyncAPI } from "./types"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

// Query cache and React state, which this test has none of
vi.mock("../modules/entry/hooks", () => ({
  invalidateEntriesQuery: vi.fn(),
  refreshEntriesHead: vi.fn(async () => {}),
}))
vi.mock("../modules/feed/hooks", () => ({
  setFeedUnreadDirty: vi.fn(),
  setFeedUnreadDirtyMany: vi.fn(),
  clearFeedUnreadDirty: vi.fn(),
  clearAllFeedUnreadDirty: vi.fn(),
}))

describe("syncEngine against SQLite", () => {
  it("stores the read state of more entries than one statement may bind", async () => {
    useUserStore.setState((state) => ({ ...state, whoami: { id: "user-1" } as never }))
    clearAccountInSession()
    startSessionCheck().confirm("user-1")
    const now = String(Date.now())
    await SyncMetaService.set("lastSyncId", "100")
    await SyncMetaService.set("unreadCalibratedAt", now)
    await SyncMetaService.set("subscriptionsCalibratedAt", now)

    const entries: EntryModel[] = Array.from({ length: 1200 }, (_, index) => ({
      id: `entry${index}`,
      guid: `entry${index}`,
      feedId: "feed-1",
      insertedAt: new Date(),
      publishedAt: new Date(),
      read: false,
    }))
    await EntryService.upsertMany(entries)
    useEntryStore.setState((state) => ({
      ...state,
      data: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
    }))

    const actions: SyncAction[] = entries.map((entry, index) => ({
      id: 101 + index,
      model: "timeline",
      modelId: null,
      action: "U",
      data: { entryIds: [entry.id], read: true, isInbox: false, feeds: { "feed-1": 1 } },
      createdAt: "2026-09-16T00:00:00.000Z",
    }))
    apiContext.provide({} as FollowAPI)
    syncApiContext.provide({
      state: vi.fn(),
      delta: vi.fn(async () => ({
        code: 0,
        data: { actions, lastSyncId: actions.at(-1)!.id, hasMore: false, reset: false },
      })),
    } as unknown as SyncAPI)

    await syncEngine.pull("interval")

    const stored = await db.query.entriesTable.findMany({ columns: { read: true } })
    expect(stored).toHaveLength(1200)
    expect(stored.every((row) => row.read)).toBe(true)
  })
})
