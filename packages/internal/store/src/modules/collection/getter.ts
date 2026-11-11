import { useCollectionStore } from "./store"

export const isEntryStarred = (entryId: string): boolean => {
  return !!useCollectionStore.getState().collections[entryId]
}
