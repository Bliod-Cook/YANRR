import appEn from "@locales/app/en.json"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { AIIndicator } from "./AISplineButton"

const { setAIPanelVisibilityMock, aiState } = vi.hoisted(() => ({
  setAIPanelVisibilityMock: vi.fn(),
  aiState: {
    isVisible: false,
    showSplineButton: true,
  },
}))

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: keyof typeof appEn) => appEn[key] ?? key,
    }),
  }
})

vi.mock("~/atoms/settings/ai", () => ({
  setAIPanelVisibility: setAIPanelVisibilityMock,
  ["useAIPanelVisibility"]: () => aiState.isVisible,
  ["useAISettingKey"]: (key: string) => {
    if (key === "showSplineButton") {
      return aiState.showSplineButton
    }
    return
  },
}))

vi.mock("~/modules/ai-chat/components/layouts/AISmartSidebar", () => ({
  AISmartSidebar: () => null,
}))

vi.mock("./AIChatFloatingPanel", () => ({
  AIChatFloatingPanel: () => null,
}))

vi.mock("motion/react", async () => {
  const React = await import("react")

  type MotionElementProps = React.HTMLAttributes<HTMLElement> & {
    animate?: unknown
    exit?: unknown
    initial?: unknown
    transition?: unknown
    whileHover?: unknown
    whileTap?: unknown
  }

  const createMotionElement =
    (tag: string) =>
    ({
      ref,
      animate,
      exit,
      initial,
      transition,
      whileHover,
      whileTap,
      ...props
    }: MotionElementProps & { ref?: React.RefObject<HTMLElement | null> }) =>
      React.createElement(tag, { ...props, ref })

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    m: new Proxy(
      {},
      {
        get: (_target, tag) => createMotionElement(String(tag)),
      },
    ),
  }
})

const renderComponent = async () => {
  const container = document.createElement("div")
  document.body.append(container)

  const root = createRoot(container)
  await act(async () => {
    root.render(<AIIndicator />)
  })

  return { container, root }
}

describe("AIIndicator", () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    aiState.isVisible = false
    aiState.showSplineButton = true
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }

    container?.remove()
    root = null
    container = null
    vi.clearAllMocks()
  })

  test("renders the bot icon and opens the AI panel", async () => {
    ;({ container, root } = await renderComponent())

    const button = container.querySelector<HTMLButtonElement>("button[title='Open AI Chat']")
    expect(button).not.toBeNull()
    expect(button?.querySelector("i")?.className).toContain("i-mgc-folo-bot-original")
    expect(button?.querySelector("i")?.className).toContain("size-16")

    await act(async () => {
      button?.click()
    })

    expect(setAIPanelVisibilityMock).toHaveBeenCalledWith(true)
  })

  test("returns to the static idle button after the AI panel closes", async () => {
    ;({ container, root } = await renderComponent())

    const button = container.querySelector<HTMLButtonElement>("button[title='Open AI Chat']")
    await act(async () => {
      button?.focus()
    })

    aiState.isVisible = true
    await act(async () => {
      root?.render(<AIIndicator />)
    })
    expect(container.querySelector("button[title='Open AI Chat']")).toBeNull()

    aiState.isVisible = false
    await act(async () => {
      root?.render(<AIIndicator />)
    })

    expect(container.querySelector("button[title='Open AI Chat']")).not.toBeNull()
  })
})
