import { useRecyclingState } from "@shopify/flash-list"
import dayjs from "dayjs"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TextProps } from "react-native"

import { Text } from "@/src/components/ui/typography/Text"

import { NativePressable } from "../pressable/NativePressable"

const formatTemplateString = "lll"

const formatTime = (
  date: string | Date,
  relativeBeforeDay?: number,
  template = formatTemplateString,
) => {
  if (relativeBeforeDay && Math.abs(dayjs(date).diff(new Date(), "d")) > relativeBeforeDay) {
    return dayjs(date).format(template)
  }
  return dayjs.duration(dayjs(date).diff(dayjs(), "minute"), "minute").humanize()
}

const getUpdateInterval = (date: dayjs.ConfigType, relativeBeforeDay?: number) => {
  if (!relativeBeforeDay) return null
  const diffInSeconds = Math.abs(dayjs(date).diff(new Date(), "second"))
  if (diffInSeconds <= 60) {
    return 1000 // Update every second
  }
  const diffInMinutes = Math.abs(dayjs(date).diff(new Date(), "minute"))
  if (diffInMinutes <= 60) {
    return 60000 // Update every minute
  }
  const diffInHours = Math.abs(dayjs(date).diff(new Date(), "hour"))
  if (diffInHours <= 24) {
    return 3600000 // Update every hour
  }
  const diffInDays = Math.abs(dayjs(date).diff(new Date(), "day"))
  if (diffInDays <= relativeBeforeDay) {
    return 86400000 // Update every day
  }
  return null // No need to update
}

interface RelativeDateTimeProps extends TextProps {
  date: string | Date
  displayAbsoluteTimeAfterDay?: number
  dateFormatTemplate?: string
  postfixText?: string
}

export const RelativeDateTime = ({
  date,
  displayAbsoluteTimeAfterDay = Infinity,
  dateFormatTemplate,
  postfixText,
  ...props
}: RelativeDateTimeProps) => {
  // dayjs formats in its global locale, which switches along with the app language, and the
  // language switch renders this again
  const { t } = useTranslation("common")
  const time = dayjs(date).valueOf()
  // Lists recycle rows for other items, which start in the relative mode
  const [mode, setMode] = useRecyclingState<"relative" | "absolute">("relative", [time])

  // Renders again once the relative time may read differently
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (mode === "absolute") return
    const interval = getUpdateInterval(time, displayAbsoluteTimeAfterDay)
    if (interval === null) return
    const timer = setTimeout(() => setTick((value) => value + 1), interval)
    return () => clearTimeout(timer)
  }, [time, displayAbsoluteTimeAfterDay, mode, tick])

  return (
    <NativePressable
      hitSlop={10}
      onPress={() => {
        setMode((mode) => (mode === "relative" ? "absolute" : "relative"))
      }}
    >
      <Text key={mode} {...props}>
        {mode === "relative"
          ? `${formatTime(date, displayAbsoluteTimeAfterDay, dateFormatTemplate)}${t("space")}${postfixText ?? t("words.ago")}`
          : dayjs(date).format(dateFormatTemplate ?? formatTemplateString)}
      </Text>
    </NativePressable>
  )
}
