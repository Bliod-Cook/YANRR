import { FeedViewType } from "@follow/constants"
import { stopPropagation } from "@follow/utils/dom"
import { clsx, cn } from "@follow/utils/utils"
import type { FC, PropsWithChildren } from "react"
import { memo, useMemo } from "react"

import { SafeFragment } from "~/components/common/Fragment"
import { RelativeDay } from "~/components/ui/datetime"
import { useShowEntryDetailsColumn } from "~/hooks/biz/useShowEntryDetailsColumn"

import { readableContentMaxWidth } from "../styles"

interface DateItemInnerProps {
  date: Date
  className?: string
  Wrapper?: FC<PropsWithChildren>
  isSticky?: boolean
}

type DateItemProps = Pick<DateItemInnerProps, "isSticky"> & {
  view: FeedViewType
  date: string
  className?: string
}
const useParseDate = (date: string) =>
  useMemo(() => {
    const dateObj = new Date(date)
    return {
      dateObj,
      startOfDay: new Date(dateObj.setHours(0, 0, 0, 0)).getTime(),
      endOfDay: new Date(dateObj.setHours(23, 59, 59, 999)).getTime(),
    }
  }, [date])

const dateItemclassName = tw`relative flex items-center text-sm lg:text-base gap-1 px-3 font-bold text-text h-9`
export const DateItem = memo(({ date, view, isSticky }: DateItemProps) => {
  const showEntryDetailsColumn = useShowEntryDetailsColumn()

  if (view === FeedViewType.SocialMedia || !showEntryDetailsColumn) {
    return <SocialMediaDateItem date={date} className={dateItemclassName} isSticky={isSticky} />
  }
  return <UniversalDateItem date={date} className={dateItemclassName} isSticky={isSticky} />
})
const UniversalDateItem = ({ date, className, isSticky }: Omit<DateItemProps, "view">) => {
  const { dateObj } = useParseDate(date)

  return (
    <DateItemInner
      className={clsx(className, readableContentMaxWidth)}
      date={dateObj}
      isSticky={isSticky}
    />
  )
}

const DateItemInner: FC<DateItemInnerProps> = ({ date, className, Wrapper, isSticky }) => {
  const W = Wrapper ?? SafeFragment

  return (
    <div
      className={cn(
        className,
        "border-b border-transparent bg-background pl-6",
        isSticky && "border-border",
      )}
      onClick={stopPropagation}
    >
      <W>
        <span className="inline-flex items-center">
          <RelativeDay date={date} />
        </span>
      </W>
    </div>
  )
}
const SocialMediaDateItem = ({
  date,
  className,
  isSticky,
}: {
  date: string
  className?: string
  isSticky?: boolean
}) => {
  const { dateObj } = useParseDate(date)

  return (
    <DateItemInner
      Wrapper={({ children }) => (
        <div
          className={cn(
            "m-auto flex w-full max-w-[645px] gap-3 pl-2 text-base select-none lg:text-lg",
          )}
        >
          {children}
        </div>
      )}
      className={className}
      date={dateObj}
      isSticky={isSticky}
    />
  )
}
