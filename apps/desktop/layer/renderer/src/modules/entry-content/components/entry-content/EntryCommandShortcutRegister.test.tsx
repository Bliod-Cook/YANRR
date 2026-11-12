import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { FeedViewType } from "@follow/constants"
import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, expect, test, vi } from "vitest"

import { jotaiStore } from "~/lib/jotai"
import { COMMAND_ID } from "~/modules/command/commands/id"
import { registerCommand } from "~/modules/command/registry/registry"

import { EntryCommandShortcutRegister } from "./EntryCommandShortcutRegister"

vi.mock("~/lib/auth", () => ({}))

beforeAll(() => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

test("runs Share with Ctrl+Alt+S when the article does not have focus", async () => {
  useEntryStore.setState({
    data: { "post-1": { id: "post-1", url: "https://example.com/post-1" } as EntryModel },
  })
  const run = vi.fn()
  const unregister = registerCommand({ id: COMMAND_ID.entry.share, label: "Share", run })
  const root = createRoot(document.createElement("div"))
  const pressShare = (target: Element) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  try {
    await act(async () => {
      root.render(
        <Provider store={jotaiStore}>
          <GlobalFocusableProvider>
            <EntryCommandShortcutRegister entryId="post-1" view={FeedViewType.Articles} />
          </GlobalFocusableProvider>
        </Provider>,
      )
    })

    const input = document.body.appendChild(document.createElement("input"))
    await act(async () => {
      pressShare(input)
    })
    input.remove()
    expect(run).not.toHaveBeenCalled()

    await act(async () => {
      pressShare(document.body)
    })

    expect(run).toHaveBeenCalledExactlyOnceWith({ entryId: "post-1" })
  } finally {
    await act(async () => root.unmount())
    unregister()
  }
})
