import type { FeedViewType } from "@follow/constants"
import { useCallback } from "react"

import { useCollectionStore } from "./store"

export const useCollectionEntry = (entryId: string) => {
  return useCollectionStore(
    useCallback(
      (state) => {
        return state.collections[entryId]
      },
      [entryId],
    ),
  )
}

export const useIsEntryStarred = (entryId: string) => {
  return useCollectionStore(
    useCallback(
      (state) => {
        return !!state.collections[entryId]
      },
      [entryId],
    ),
  )
}

const NO_ENTRY_IDS: string[] = []

/** Starred entries, newest first; none while not `enabled`, see `useEntryIdsByView` */
export const useCollectionEntryList = (view: FeedViewType, enabled = true) => {
  return useCollectionStore(
    useCallback(
      (state) => {
        if (!enabled) return NO_ENTRY_IDS
        return Object.values(state.collections)
          .filter((collection) => collection.view === view)
          .sort((a, b) => (new Date(a.createdAt ?? 0) > new Date(b.createdAt ?? 0) ? -1 : 1))
          .map((i) => i.entryId)
      },
      [enabled, view],
    ),
  )
}
