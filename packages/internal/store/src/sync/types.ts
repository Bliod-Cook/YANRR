import type { SyncAction as SdkSyncAction } from "@follow-app/client-sdk"

import type { FollowAPI } from "../types"

/** The server's `/sync` endpoints: the apps hand `followApi.sync` to the store through `syncApiContext`. */
export type SyncAPI = FollowAPI["sync"]

/**
 * A change-log row. Besides the models the SDK names, there are those handled through
 * `registerSyncModel`: "action", "setting", "messaging", ...
 */
export type SyncAction = Omit<SdkSyncAction, "model"> & {
  model: SdkSyncAction["model"] | (string & {})
}

export interface TimelineReadActionData {
  /** Entries whose read state really flipped on the server. */
  entryIds: string[]
  read: boolean
  isInbox: boolean
  /** Flipped rows per feed id or inbox handle */
  feeds: Record<string, number>
}

export interface TimelineNewEntriesActionData {
  /** Set for entries delivered by a feed */
  feedId?: string
  /** Set together with `isInbox` for entries delivered to an inbox */
  inboxId?: string
  isInbox?: boolean
  /** Rows really written to the user's timeline. */
  count: number
  /** How many of them arrived unread */
  unread: number
  latestPublishedAt: string
  from: string[]
}

export interface InboxEntryActionData {
  inboxId: string
  /** Whether the deleted entry was unread */
  unread: boolean
}

export interface CollectionActionData {
  entryId: string
  feedId: string
  view: number
  createdAt: string
}
