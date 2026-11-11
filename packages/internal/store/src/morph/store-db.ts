import type { SubscriptionSchema } from "@follow/database/schemas/types"

import type { SubscriptionModel } from "../modules/subscription/types"

class StoreDbMorph {
  toSubscriptionSchema(subscription: SubscriptionModel): SubscriptionSchema {
    return {
      ...subscription,
      id: buildSubscriptionDbId(subscription),
    }
  }
}

export const storeDbMorph = new StoreDbMorph()

export const buildSubscriptionDbId = (subscription: SubscriptionModel) => {
  if (subscription.feedId) return `${subscription.type}/${subscription.feedId}`
  if (subscription.inboxId) return `${subscription.type}/${subscription.inboxId}`
  throw new Error("Invalid subscription")
}
