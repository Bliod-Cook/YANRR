import { useSortedUngroupedSubscription } from "@follow/store/subscription/hooks"
import type { FC } from "react"

import { useHideAllReadSubscriptions } from "@/src/atoms/settings/general"

import { SUBSCRIPTION_SORT } from "./constants"
import { SubscriptionItem } from "./items/SubscriptionItem"

export const UnGroupedList: FC<{
  subscriptionIds: string[]
  isLastGroup?: boolean
}> = ({ subscriptionIds, isLastGroup }) => {
  const hideAllReadSubscriptions = useHideAllReadSubscriptions()
  const sortedSubscriptionIds = useSortedUngroupedSubscription({
    ids: subscriptionIds,
    ...SUBSCRIPTION_SORT,
    hideAllReadSubscriptions,
  })

  return sortedSubscriptionIds.map((id, index) => (
    <SubscriptionItem
      key={id}
      id={id}
      isFirst={false}
      isLast={!!isLastGroup && index === sortedSubscriptionIds.length - 1}
    />
  ))
}
