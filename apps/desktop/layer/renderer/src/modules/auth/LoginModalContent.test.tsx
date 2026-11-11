import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"

import { LoginModalContent } from "./LoginModalContent"

vi.mock("~/components/ui/modal/stacked/hooks", () => ({
  useCurrentModal: () => ({ dismiss: vi.fn() }),
}))
vi.mock("~/queries/auth", () => ({ useSession: () => ({ status: "unauthenticated" }) }))
vi.mock("~/modules/server-setup/CurrentServer", () => ({ CurrentServer: () => null }))
vi.mock("./Form", () => {
  type FormProps = { onLoginStateChange?: (state: "register" | "login") => void }
  return {
    LoginWithPassword: ({ onLoginStateChange }: FormProps) => (
      <button
        type="button"
        data-form="login"
        data-can-register={onLoginStateChange ? "" : undefined}
        onClick={() => onLoginStateChange?.("register")}
      />
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

  const render = async () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () => root.render(<LoginModalContent />))
    return { host, unmount: () => act(async () => root.unmount()) }
  }

  const openServer = { ai: false, push: false, registration: true }

  test("opens on signing in, with registering a click away on a server that takes sign-ups", async () => {
    setServerConfigs(openServer)
    const { host, unmount } = await render()

    expect(host.querySelector("[data-form]")?.getAttribute("data-form")).toBe("login")

    await act(async () => (host.querySelector("[data-form=login]") as HTMLElement).click())
    expect(host.querySelector("[data-form]")?.getAttribute("data-form")).toBe("register")
    await unmount()
  })

  test("offers signing in only when the server closed registration or has not answered", async () => {
    for (const configs of [{ ...openServer, registration: false }, null]) {
      setServerConfigs(configs)
      const { host, unmount } = await render()

      expect(host.querySelector("[data-form=login]")).not.toBeNull()
      expect(host.querySelector("[data-can-register]")).toBeNull()
      await act(async () => (host.querySelector("[data-form=login]") as HTMLElement).click())
      expect(host.querySelector("[data-form=register]")).toBeNull()
      await unmount()
    }
  })
})
