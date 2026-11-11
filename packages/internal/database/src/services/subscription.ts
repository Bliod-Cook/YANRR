import { eq, inArray } from "drizzle-orm"

import { db } from "../db"
import { feedsTable, inboxesTable, subscriptionsTable } from "../schemas"
import type { SubscriptionSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

class SubscriptionServiceStatic implements Resetable {
  getSubscriptionAll() {
    return db.query.subscriptionsTable.findMany()
  }

  async reset() {
    await db.delete(subscriptionsTable).execute()
  }
  async upsertMany(subscriptions: SubscriptionSchema[]) {
    if (subscriptions.length === 0) return
    await db
      .insert(subscriptionsTable)
      .values(subscriptions)
      .onConflictDoUpdate({
        target: [subscriptionsTable.id],
        // Every column but the id, so columns added later aren't left stale
        set: conflictUpdateAllExcept(subscriptionsTable, ["id"]),
      })
  }

  async patch(subscription: Partial<SubscriptionSchema> & { id: string }) {
    await db
      .update(subscriptionsTable)
      .set(subscription)
      .where(eq(subscriptionsTable.id, subscription.id))
  }

  async patchMany({ feedIds, data }: { feedIds: string[]; data: Partial<SubscriptionSchema> }) {
    await db.update(subscriptionsTable).set(data).where(inArray(subscriptionsTable.feedId, feedIds))
  }

  async delete(id: string | string[]) {
    const ids = Array.isArray(id) ? id : [id]

    const results = await db.query.subscriptionsTable.findMany({
      where: inArray(subscriptionsTable.id, ids),
      columns: {
        feedId: true,
        type: true,
        inboxId: true,
      },
    })

    await db.delete(subscriptionsTable).where(inArray(subscriptionsTable.id, ids)).execute()

    if (!results || results.length === 0) return

    // Cleanup
    for (const result of results) {
      const { type, feedId, inboxId } = result
      switch (type) {
        case "feed": {
          if (!feedId) break
          await db.delete(feedsTable).where(eq(feedsTable.id, feedId)).execute()
          break
        }
        case "inbox": {
          if (!inboxId) break
          await db.delete(inboxesTable).where(eq(inboxesTable.id, inboxId)).execute()
          break
        }
      }
    }
  }
}
export const SubscriptionService = new SubscriptionServiceStatic()
