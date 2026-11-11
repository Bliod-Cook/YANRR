import type { CollectionSchema } from "@follow/database/schemas/types"

export type CollectionModel = CollectionSchema

/** A collection as a timeline lists it, without its view where the server leaves that out */
export type RemoteCollectionModel = Omit<CollectionModel, "view"> & {
  view?: CollectionModel["view"]
}
