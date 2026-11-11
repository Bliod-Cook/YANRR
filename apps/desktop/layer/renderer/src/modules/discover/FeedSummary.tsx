import { Skeleton } from "@follow/components/ui/skeleton/index.js"
import type { FeedModel } from "@follow/store/feed/types"
import type { FC } from "react"
import { useTranslation } from "react-i18next"

import { RelativeTime } from "~/components/ui/datetime"

import { FollowSummary } from "../feed/feed-summary"

export interface FeedSummaryProps {
  feed: FeedModel
  isLoading?: boolean
}
export const FeedSummary: FC<FeedSummaryProps> = ({ feed, isLoading }) => {
  const { t } = useTranslation("common")
  const showSkeleton = isLoading && !("updatedAt" in feed && feed.updatedAt)

  return (
    <div>
      <FollowSummary feed={feed} />

      <div className="mt-2 flex h-6 justify-between gap-4 pl-10 text-callout">
        {showSkeleton ? (
          <Skeleton className="mt-1 h-5 w-40" />
        ) : (
          <div className="flex items-center gap-3 text-text-secondary">
            {"updatedAt" in feed && feed.updatedAt ? (
              <div className="flex items-center gap-1.5">
                <i className="i-mgc-safety-certificate-cute-re" />
                <span>{t("feed.updated_at")}</span>
                <RelativeTime date={feed.updatedAt} displayAbsoluteTimeAfterDay={Infinity} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
