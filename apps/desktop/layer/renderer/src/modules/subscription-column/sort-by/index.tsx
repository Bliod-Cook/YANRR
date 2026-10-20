import { useFeedListSortSelector } from "../atom"
import { SortByAlphabeticalFeedList, SortByAlphabeticalInboxList } from "./SortByAlphabeticalList"
import { SortByUnreadFeedList } from "./SortByUnreadList"
import type { FeedListProps, InboxListProps } from "./types"

export const SortableFeedList = (props: FeedListProps) => {
  const by = useFeedListSortSelector((s) => s.by)

  switch (by) {
    case "count": {
      return <SortByUnreadFeedList {...props} />
    }
    case "alphabetical": {
      return <SortByAlphabeticalFeedList {...props} />
    }
  }
}

export const SortByAlphabeticalInbox = (props: InboxListProps) => {
  const by = useFeedListSortSelector((s) => s.by)

  switch (by) {
    default: {
      return <SortByAlphabeticalInboxList {...props} />
    }
  }
}
