import type { EntrySchema, SubscriptionSchema } from "@follow/database/schemas/types"

import type { EntryModel } from "../modules/entry/types"
import type { SubscriptionModel } from "../modules/subscription/types"

class StoreDbMorph {
  toSubscriptionSchema(subscription: SubscriptionModel): SubscriptionSchema {
    return {
      ...subscription,
      isPrivate: false,
      id: buildSubscriptionDbId(subscription),
    }
  }
  toEntrySchema(entry: EntryModel): EntrySchema {
    return {
      ...entry,
    }
  }
}

export const storeDbMorph = new StoreDbMorph()

export const buildSubscriptionDbId = (subscription: SubscriptionModel) => {
  if (subscription.feedId) return `${subscription.type}/${subscription.feedId}`
  if (subscription.inboxId) return `${subscription.type}/${subscription.inboxId}`
  throw new Error("Invalid subscription")
}
