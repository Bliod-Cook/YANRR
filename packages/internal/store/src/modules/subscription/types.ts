import type { FeedViewType } from "@follow/constants"
import type { SubscriptionSchema } from "@follow/database/schemas/types"

type Nullable<T> = T | null | undefined

export interface SubscriptionForm {
  url: string | undefined
  view: FeedViewType
  category: Nullable<string>
  hideFromTimeline: Nullable<boolean>
  title: Nullable<string>
  feedId: Nullable<string>
}

/** `isPrivate` is a column the server no longer has; the database is written `false` */
export type SubscriptionModel = Omit<SubscriptionSchema, "id" | "isPrivate">
