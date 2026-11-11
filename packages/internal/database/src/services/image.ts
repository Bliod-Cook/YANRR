import { desc, notInArray } from "drizzle-orm"

import { db } from "../db"
import { imagesTable } from "../schemas"
import type { ImageSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

/** The colours of only this many images, the most recently stored, are kept across launches */
export const IMAGES_KEPT = 100

class ImageServiceStatic implements Resetable {
  async reset() {
    await db.delete(imagesTable).execute()
  }

  async upsertMany(imageColors: ImageSchema[]) {
    if (imageColors.length === 0) return
    await db
      .insert(imagesTable)
      .values(imageColors)
      .onConflictDoUpdate({
        target: [imagesTable.url],
        set: conflictUpdateAllExcept(imagesTable, ["url"]),
      })
  }

  /** The colours of the most recent images; older ones are deleted */
  async getImagesToHydrate() {
    const kept = db
      .select({ url: imagesTable.url })
      .from(imagesTable)
      .orderBy(desc(imagesTable.createdAt))
      .limit(IMAGES_KEPT)
    await db.delete(imagesTable).where(notInArray(imagesTable.url, kept))
    return db.query.imagesTable.findMany()
  }
}

export const ImagesService = new ImageServiceStatic()
