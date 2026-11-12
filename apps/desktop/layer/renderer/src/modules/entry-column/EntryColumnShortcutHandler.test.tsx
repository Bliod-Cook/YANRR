import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, expect, test, vi } from "vitest"

import { Focusable } from "~/components/common/Focusable"
import { HotkeyScope } from "~/constants"
import { jotaiStore } from "~/lib/jotai"
import { useRegisterTimelineCommand } from "~/modules/command/commands/timeline"

import { EntryColumnShortcutHandler } from "./EntryColumnShortcutHandler"

vi.mock("~/lib/auth", () => ({}))

beforeAll(() => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

const TimelineCommands = () => {
  useRegisterTimelineCommand()
  return null
}

test("refreshes the timeline on its shortcut while another column has the focus", async () => {
  const refetch = vi.fn()
  const root = createRoot(document.createElement("div"))
  await act(async () => {
    root.render(
      <Provider store={jotaiStore}>
        <GlobalFocusableProvider>
          <TimelineCommands />
          <Focusable scope={HotkeyScope.Timeline}>
            <EntryColumnShortcutHandler refetch={refetch} data={[]} handleScrollTo={vi.fn()} />
          </Focusable>
        </GlobalFocusableProvider>
      </Provider>,
    )
  })

  // Nothing holds the focus here, as when the list of subscriptions or the article does
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true, cancelable: true }),
    )
  })

  expect(refetch).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
})
