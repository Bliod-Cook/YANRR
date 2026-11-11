import { RelativeTime as RelativeTimeBase } from "@follow/components/ui/datetime/index.js"
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@follow/components/ui/tooltip/index.js"
import { stopPropagation } from "@follow/utils/dom"
import dayjs from "dayjs"
import type { ComponentProps } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { useUISettingKey } from "~/atoms/settings/ui"

// Absolute dates follow the Date Format setting unless the caller asks for a format
export const RelativeTime = (props: ComponentProps<typeof RelativeTimeBase>) => {
  const dateFormat = useUISettingKey("dateFormat")
  return <RelativeTimeBase {...props} dateFormatTemplate={props.dateFormatTemplate ?? dateFormat} />
}

export const RelativeDay = ({
  date,
  plain,
}: {
  date: Date
  /** Text only, without the tooltip button, for use inside another control such as a menu item */
  plain?: boolean
}) => {
  const { t } = useTranslation("common")

  const dateFormatValue = useUISettingKey("dateFormat")
  const formatTemplateString = "lll"
  const dateFormat = dateFormatValue === "default" ? formatTemplateString : dateFormatValue

  const formatDateString = useCallback(
    (date: Date) => {
      const now = new Date()

      // Remove the time part for comparison
      const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const inputDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

      const diffTime = nowDate.getTime() - inputDate.getTime()
      const diffDays = diffTime / (1000 * 3600 * 24)

      if (diffDays === 0) {
        return t("time.today")
      } else if (diffDays === 1) {
        return t("time.yesterday")
      } else {
        return dayjs(date).format("ll")
      }
    },
    [t],
  )

  const [dateString, setDateString] = useState<string>(() => formatDateString(date))

  // "Today" and "yesterday" change at local midnight, however long the app stays open
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const update = () => {
      setDateString(formatDateString(date))
      const now = new Date()
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = setTimeout(update, nextMidnight.getTime() - now.getTime() + 1000)
    }
    update()
    return () => clearTimeout(timer)
  }, [date, formatDateString])

  const formated = useMemo(() => dayjs(date).format(dateFormat), [dateFormat, date])

  if (plain || formated === dateString) {
    return <>{dateString}</>
  }
  return (
    <Tooltip>
      <TooltipTrigger onFocusCapture={stopPropagation}>{dateString}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{formated}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  )
}
