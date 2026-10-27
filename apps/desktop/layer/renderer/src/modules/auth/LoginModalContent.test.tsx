import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test, vi } from "vitest"

import { LoginModalContent } from "./LoginModalContent"

vi.mock("~/components/ui/modal/stacked/hooks", () => ({
  useCurrentModal: () => ({ dismiss: vi.fn() }),
}))
vi.mock("~/queries/auth", () => ({ useSession: () => ({ status: "unauthenticated" }) }))
vi.mock("~/modules/server-setup/CurrentServer", () => ({ CurrentServer: () => null }))
vi.mock("./Form", () => {
  type FormProps = { onLoginStateChange: (state: "register" | "login") => void }
  return {
    LoginWithPassword: ({ onLoginStateChange }: FormProps) => (
      <button type="button" data-form="login" onClick={() => onLoginStateChange("register")} />
    ),
    RegisterForm: () => <form data-form="register" />,
  }
})

describe("LoginModalContent", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  test("opens on signing in, with registering a click away", async () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () => root.render(<LoginModalContent />))

    expect(host.querySelector("[data-form]")?.getAttribute("data-form")).toBe("login")

    await act(async () => (host.querySelector("[data-form=login]") as HTMLElement).click())
    expect(host.querySelector("[data-form]")?.getAttribute("data-form")).toBe("register")
    await act(async () => root.unmount())
  })
})
