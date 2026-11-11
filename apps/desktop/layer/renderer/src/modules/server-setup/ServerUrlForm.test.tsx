import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

const ipc = vi.hoisted(() => ({
  setServerUrl: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock("~/lib/client", () => ({
  ipcServices: { auth: { setServerUrl: ipc.setServerUrl }, app: { relaunch: ipc.relaunch } },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { ServerUrlForm } = await import("./ServerUrlForm")

describe("ServerUrlForm", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    root = null
    host = null
    vi.clearAllMocks()
  })

  const submit = async (beforeRelaunch?: () => Promise<void>) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ServerUrlForm beforeRelaunch={beforeRelaunch} />)
    })
    const input = host.querySelector("input")!
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setValue.call(input, "https://rss.example.com")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      host!.querySelector("form")!.requestSubmit()
    })
  }

  test("relaunches after the server is set and the old data is cleared", async () => {
    ipc.setServerUrl.mockResolvedValue(null)
    const beforeRelaunch = vi.fn().mockResolvedValue(undefined)

    await submit(beforeRelaunch)

    expect(beforeRelaunch).toHaveBeenCalledOnce()
    expect(ipc.relaunch).toHaveBeenCalledOnce()
  })

  test("stops connecting and reports it when the main process fails", async () => {
    ipc.setServerUrl.mockRejectedValue(new Error("ipc down"))

    await submit()

    expect(host!.textContent).toContain("server.failed")
    expect(host!.querySelector("button[type=submit]")!.hasAttribute("disabled")).toBe(false)
    expect(ipc.relaunch).not.toHaveBeenCalled()
  })

  test("reports a failed cleanup and stays instead of relaunching with the old data", async () => {
    ipc.setServerUrl.mockResolvedValue(null)

    await submit(() => Promise.reject(new Error("db locked")))

    expect(host!.textContent).toContain("server.failed")
    expect(ipc.relaunch).not.toHaveBeenCalled()
  })
})
