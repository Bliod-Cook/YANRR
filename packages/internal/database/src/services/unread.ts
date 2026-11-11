import { db, withTransaction } from "../db"
import { unreadTable } from "../schemas"
import type { UnreadSchema } from "../schemas/types"
import type { DB } from "../types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

interface UnreadUpdateOptions {
  /** Replace every stored count */
  reset?: boolean
  /** Write in this transaction instead of one of its own */
  tx?: DB
}

class UnreadServiceStatic implements Resetable {
  async reset() {
    await db.delete(unreadTable).execute()
  }

  async getUnreadAll() {
    return db.query.unreadTable.findMany()
  }

  async upsertMany(unreads: UnreadSchema[], { reset, tx }: UnreadUpdateOptions = {}) {
    // An empty snapshot still replaces the stored counts, or they come back on the next launch
    if (unreads.length === 0 && !reset) return
    if (!tx) {
      await withTransaction((tx) => this.upsertMany(unreads, { reset, tx }))
      return
    }
    if (reset) {
      await tx.delete(unreadTable)
    }
    if (unreads.length === 0) return
    await tx
      .insert(unreadTable)
      .values(unreads)
      .onConflictDoUpdate({
        target: [unreadTable.id],
        set: conflictUpdateAllExcept(unreadTable, ["id"]),
      })
  }
}

export const UnreadService = new UnreadServiceStatic()
