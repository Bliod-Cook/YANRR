// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { FollowAPI } from "../../api-contract"
import { apiContext } from "../../context"
import { ENTRY_OPENED_AFTER_MS, useRecordEntryOpened } from "./reading-history"

const opened = vi.fn(async () => ({ code: 0 as const }))

const Probe = ({ entryId, enabled }: { entryId: string; enabled: boolean }) => {
  useRecordEntryOpened(entryId, enabled)
  return null
}

describe("useRecordEntryOpened", () => {
  let root: ReturnType<typeof createRoot>

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    apiContext.provide({ readingHistory: { opened } } as unknown as FollowAPI)
  })

  beforeEach(() => {
    vi.useFakeTimers()
    opened.mockClear()
    root = createRoot(document.createElement("div"))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
  })

  const show = (entryId: string, enabled = true) =>
    act(async () => root.render(createElement(Probe, { entryId, enabled })))

  it("records an entry that stays open", async () => {
    await show("a")
    await act(async () => vi.advanceTimersByTime(ENTRY_OPENED_AFTER_MS))

    expect(opened).toHaveBeenCalledExactlyOnceWith({ entryId: "a" })
  })

  it("leaves out entries skimmed past", async () => {
    await show("a")
    await act(async () => vi.advanceTimersByTime(ENTRY_OPENED_AFTER_MS - 1))
    await show("b")
    await act(async () => vi.advanceTimersByTime(ENTRY_OPENED_AFTER_MS))

    expect(opened).toHaveBeenCalledExactlyOnceWith({ entryId: "b" })
  })

  it("records nothing while disabled", async () => {
    await show("a", false)
    await act(async () => vi.advanceTimersByTime(ENTRY_OPENED_AFTER_MS))

    expect(opened).not.toHaveBeenCalled()
  })
})
