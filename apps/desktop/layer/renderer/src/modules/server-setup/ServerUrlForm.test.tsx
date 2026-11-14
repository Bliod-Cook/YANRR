import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

const ipc = vi.hoisted(() => ({
  calls: [] as string[],
  checkServerUrl: vi.fn(),
  setServerUrl: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock("~/lib/client", () => ({
  ipcServices: {
    auth: { checkServerUrl: ipc.checkServerUrl, setServerUrl: ipc.setServerUrl },
    app: { relaunch: ipc.relaunch },
  },
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
    ipc.calls.length = 0
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

  test("keeps the new server once the old data is cleared, then relaunches", async () => {
    ipc.checkServerUrl.mockImplementation(async () => {
      ipc.calls.push("check")
      return { server: "https://rss.example.com" }
    })
    ipc.setServerUrl.mockImplementation(async () => void ipc.calls.push("set"))
    ipc.relaunch.mockImplementation(() => void ipc.calls.push("relaunch"))

    await submit(async () => void ipc.calls.push("clear"))

    expect(ipc.calls).toEqual(["check", "clear", "set", "relaunch"])
    expect(ipc.setServerUrl).toHaveBeenCalledWith("https://rss.example.com")
  })

  test("reports a server that does not answer, without clearing anything", async () => {
    ipc.checkServerUrl.mockResolvedValue({ error: "unreachable" })
    const beforeRelaunch = vi.fn()

    await submit(beforeRelaunch)

    expect(host!.textContent).toContain("server.unreachable")
    expect(beforeRelaunch).not.toHaveBeenCalled()
    expect(ipc.setServerUrl).not.toHaveBeenCalled()
  })

  test("stops connecting and reports it when the main process fails", async () => {
    ipc.checkServerUrl.mockRejectedValue(new Error("ipc down"))

    await submit()

    expect(host!.textContent).toContain("server.failed")
    expect(host!.querySelector("button[type=submit]")!.hasAttribute("disabled")).toBe(false)
    expect(ipc.relaunch).not.toHaveBeenCalled()
  })

  test("stays on the server before when the cleanup fails", async () => {
    ipc.checkServerUrl.mockResolvedValue({ server: "https://rss.example.com" })

    await submit(() => Promise.reject(new Error("db locked")))

    expect(host!.textContent).toContain("server.failed")
    expect(ipc.setServerUrl).not.toHaveBeenCalled()
    expect(ipc.relaunch).not.toHaveBeenCalled()
  })
})
