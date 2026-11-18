import { eq, inArray } from "drizzle-orm"

import { db, withTransaction } from "../db"
import { collectionsTable } from "../schemas"
import type { CollectionSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

export interface CollectionWriteOptions {
  reset?: boolean
  /** A complete snapshot can cover a single view. */
  view?: number
}

class CollectionServiceStatic implements Resetable {
  async reset() {
    await db.delete(collectionsTable).execute()
  }

  async upsertMany(collections: CollectionSchema[], options?: CollectionWriteOptions) {
    // An empty snapshot still replaces the stored collections, or they come back on the next launch
    if (collections.length === 0 && !options?.reset) return
    await withTransaction(async (tx) => {
      if (options?.reset) {
        await tx
          .delete(collectionsTable)
          .where(options.view === undefined ? undefined : eq(collectionsTable.view, options.view))
      }
      if (collections.length === 0) return
      await tx
        .insert(collectionsTable)
        .values(collections)
        .onConflictDoUpdate({
          target: [collectionsTable.entryId],
          set: conflictUpdateAllExcept(collectionsTable, ["entryId"]),
        })
    })
  }

  async deleteMany(entryId: string[]) {
    if (entryId.length === 0) return
    await db.delete(collectionsTable).where(inArray(collectionsTable.entryId, entryId))
  }

  getCollectionAll() {
    return db.query.collectionsTable.findMany()
  }
}

export const CollectionService = new CollectionServiceStatic()
