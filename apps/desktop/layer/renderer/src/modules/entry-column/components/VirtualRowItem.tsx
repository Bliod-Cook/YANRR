import { useEntry } from "@follow/store/entry/hooks"
import { clsx } from "@follow/utils/utils"
import type { FC, Key } from "react"
import { Fragment, memo, useMemo } from "react"

import { useRouteParams } from "~/hooks/biz/useRouteParams"

import { EntryVirtualListItem } from "../item"
import { DateItem } from "./DateItem"

interface VirtualRowItemProps {
  virtualRowKey: Key
  entriesIds: string[]
  virtualRowIndex: number
  view: any
  transform: string
  isStickyItem: boolean
  isActiveStickyItem: boolean
  measureElement: (element: Element | null) => void
  currentFeedTitle?: string
}

const EntryHeadDateItem: FC<{
  entryId: string
  isSticky?: boolean
}> = ({ entryId, isSticky }) => {
  const publishedAt = useEntry(entryId, (state) => state.publishedAt)

  const { view } = useRouteParams()

  if (!publishedAt) return null
  const date = new Date(publishedAt).toDateString()

  return <DateItem isSticky={isSticky} date={date} view={view} />
}

export const VirtualRowItem: FC<VirtualRowItemProps> = memo(
  ({
    virtualRowKey,
    entriesIds,
    virtualRowIndex,
    view,
    transform,
    isStickyItem,
    isActiveStickyItem,
    measureElement,
    currentFeedTitle,
  }) => {
    return (
      <Fragment key={virtualRowKey}>
        {isStickyItem && (
          <div
            className={clsx(
              isActiveStickyItem
                ? "sticky top-0 z-[1]"
                : "absolute top-0 left-0 w-full will-change-transform",
            )}
            style={
              !isActiveStickyItem
                ? {
                    transform,
                  }
                : undefined
            }
          >
            <EntryHeadDateItem
              entryId={entriesIds[virtualRowIndex]!}
              isSticky={isActiveStickyItem}
            />
          </div>
        )}

        <EntryVirtualListItem
          currentFeedTitle={currentFeedTitle}
          entryId={entriesIds[virtualRowIndex]!}
          view={view}
          data-index={virtualRowIndex}
          style={useMemo(
            () => ({
              transform,
              paddingTop: isStickyItem ? "2rem" : undefined,
            }),
            [transform, isStickyItem],
          )}
          ref={measureElement}
        />
      </Fragment>
    )
  },
)
