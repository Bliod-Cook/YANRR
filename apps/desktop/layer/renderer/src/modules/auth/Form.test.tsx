import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { LoginWithPassword } from "./Form"

const signInWithEmail = vi.hoisted(() => vi.fn())

// The request itself is tested against a server in `lib/auth.test.ts`
vi.mock("~/lib/auth", () => ({ signInWithEmail }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("LoginWithPassword", () => {
  let reload: ReturnType<typeof vi.spyOn>
  let host: HTMLElement
  let unmount: () => void

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()
    reload = vi.spyOn(window.location, "reload").mockImplementation(() => {})
  })

  afterEach(async () => {
    await act(async () => unmount())
    reload.mockRestore()
  })

  const submit = async () => {
    host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    unmount = () => {
      root.unmount()
      host.remove()
    }
    await act(async () => root.render(<LoginWithPassword onLoginStateChange={() => {}} />))

    await act(async () => {
      type(host.querySelector('[data-testid="login-email-input"]')!, "me@example.com")
      type(host.querySelector('[data-testid="login-password-input"]')!, "a-long-password")
    })
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => expect(signInWithEmail).toHaveBeenCalled())
    // The submission settles
    await act(async () => {})
  }

  test("starts the app over as the user who signed in", async () => {
    signInWithEmail.mockResolvedValue({ error: null })

    await submit()

    expect(signInWithEmail).toHaveBeenCalledWith("me@example.com", "a-long-password")
    expect(reload).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  test("says why the server refused, and stays", async () => {
    signInWithEmail.mockResolvedValue({
      error: { status: 401, message: "Invalid email or password" },
    })

    await submit()

    expect(toast.error).toHaveBeenCalledWith("Invalid email or password")
    expect(reload).not.toHaveBeenCalled()
  })

  test("says that the server could not be reached, and stays", async () => {
    signInWithEmail.mockRejectedValue(new TypeError("Failed to fetch"))

    await submit()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })
})
