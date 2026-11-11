import { apiContext } from "@follow/store/context"
import { useUserStore } from "@follow/store/user/store"
import appEn from "@locales/app/en.json"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { setGeneralSetting } from "~/atoms/settings/general"

import { settingSyncQueue } from "./sync-queue"
import { SettingSyncIndicator } from "./SyncIndicator"

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: keyof typeof appEn) => appEn[key] }),
}))

describe("setting sync indicator", () => {
  let root: Root
  let container: HTMLElement
  let serverIsDown: boolean

  const shown = () => container.querySelector("[role=img]")?.getAttribute("aria-label")
  const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  beforeEach(async () => {
    // The shared icons are compiled with the classic JSX runtime here
    vi.stubGlobal("React", React)
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    localStorage.clear()
    serverIsDown = false
    apiContext.provide({
      settings: {
        update: async () => {
          if (serverIsDown) throw new TypeError("Failed to fetch")
          return { code: 0 }
        },
      },
    } as never)
    useUserStore.setState({ whoami: { id: "user-1" } as never })
    settingSyncQueue.init()

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<SettingSyncIndicator />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    settingSyncQueue.teardown()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test("says whether a change is on its way, could not be sent, or is with the server", async () => {
    expect(shown()).toBe("Synced with server")

    serverIsDown = true
    act(() => setGeneralSetting("unreadOnly", true))
    expect(shown()).toBe("Syncing changes")

    await pass(1000)
    expect(shown()).toBe("Changes not synced yet, retrying")

    serverIsDown = false
    await pass(1000)
    expect(shown()).toBe("Synced with server")
  })
})
