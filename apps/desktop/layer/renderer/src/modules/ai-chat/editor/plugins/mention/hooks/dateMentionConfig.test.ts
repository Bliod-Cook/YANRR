import "dayjs/locale/zh-cn"

import dayjs from "dayjs"
import { describe, expect, it } from "vitest"

import { RELATIVE_DATE_DEFINITIONS } from "./dateMentionConfig"

const dayInThisWeek = (weekday: string, today: dayjs.Dayjs) =>
  RELATIVE_DATE_DEFINITIONS.find(
    (definition) => definition.id === `date:relative:this-week-${weekday}`,
  )!
    .range(today)
    .start.format("YYYY-MM-DD")

describe("weekday date mentions", () => {
  // A Wednesday
  const today = "2026-11-11"

  it("finds the weekdays of a week that starts on Sunday", () => {
    const enToday = dayjs(today).locale("en")
    expect(dayInThisWeek("sunday", enToday)).toBe("2026-11-08")
    expect(dayInThisWeek("monday", enToday)).toBe("2026-11-09")
    expect(dayInThisWeek("saturday", enToday)).toBe("2026-11-14")
  })

  it("finds the weekdays of a week that starts on Monday", () => {
    const zhToday = dayjs(today).locale("zh-cn")
    expect(dayInThisWeek("monday", zhToday)).toBe("2026-11-09")
    expect(dayInThisWeek("wednesday", zhToday)).toBe("2026-11-11")
    expect(dayInThisWeek("sunday", zhToday)).toBe("2026-11-15")
  })
})
