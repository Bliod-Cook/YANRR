// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

const render = async (element: ReturnType<typeof createElement>) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () => root.render(element))
  return { container, root }
}

test("updates mounted subscribers when the startup finishes after first render", async () => {
  const { setStartupReady, useStartupState } = await import("./startup")
  const Status = () => createElement("p", null, useStartupState().ready ? "ready" : "waiting")
  const { container, root } = await render(
    createElement("div", null, createElement(Status), createElement(Status)),
  )

  try {
    expect(container.textContent).toBe("waitingwaiting")
    await act(async () => setStartupReady())
    expect(container.textContent).toBe("readyready")

    // A consumer mounting after the startup must immediately see completion.
    await act(async () => root.render(createElement(Status)))
    expect(container.textContent).toBe("ready")
  } finally {
    await act(async () => root.unmount())
  }
})

test("replaces the pending snapshot when the startup fails so the recovery UI can render", async () => {
  const { setStartupFailed, useStartupState } = await import("./startup")
  const Status = () => createElement("p", null, useStartupState().error?.message ?? "waiting")
  const { container, root } = await render(createElement(Status))

  try {
    expect(container.textContent).toBe("waiting")
    await act(async () => setStartupFailed(new Error("test startup failure")))
    expect(container.textContent).toBe("test startup failure")
  } finally {
    await act(async () => root.unmount())
  }
})

test("settles the ready promise with the outcome of the startup", async () => {
  const done = await import("./startup")
  done.setStartupReady()
  await expect(done.appReady).resolves.toBeUndefined()

  vi.resetModules()
  const failed = await import("./startup")
  failed.setStartupFailed(new Error("boom"))
  await expect(failed.appReady).rejects.toThrow("boom")
})
