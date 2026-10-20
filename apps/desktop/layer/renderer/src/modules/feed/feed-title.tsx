import { EllipsisHorizontalTextWithTooltip } from "@follow/components/ui/typography/EllipsisWithTooltip.js"
import type { FeedModel } from "@follow/store/feed/types"
import type { InboxModel } from "@follow/store/inbox/types"
import { cn } from "@follow/utils/utils"

import { getPreferredTitle } from "~/store/feed/hooks"

export const FeedTitle = ({
  feed,
  className,
  titleClassName,
  title,
  style,
}: {
  feed?: FeedModel | InboxModel | null
  className?: string
  titleClassName?: string
  title?: string | null
  style?: React.CSSProperties
}) => {
  if (!feed) return null

  return (
    <div className={cn("flex select-none items-center truncate", className)} style={style}>
      <EllipsisHorizontalTextWithTooltip className={cn("truncate", titleClassName)}>
        {title || getPreferredTitle(feed)}
      </EllipsisHorizontalTextWithTooltip>
    </div>
  )
}
