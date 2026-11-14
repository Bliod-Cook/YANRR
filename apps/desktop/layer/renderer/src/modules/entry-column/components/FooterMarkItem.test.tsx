import { FeedViewType } from "@follow/constants"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, expect, test, vi } from "vitest"

import { FooterMarkItem } from "./FooterMarkItem"

vi.mock("~/lib/auth", () => ({}))
vi.mock("~/hooks/biz/useRouteParams", () => ({ getRouteParams: () => ({}) }))
vi.mock("~/hooks/common/useRequireLogin", () => ({
  useRequireLogin: () => ({ ensureLogin: () => true }),
}))
vi.mock("../hooks/useMarkAll", () => ({ markAllByRoute: () => Promise.resolve() }))

beforeAll(() => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

test("offers marking read again once newer entries are listed", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  const render = (insertedBefore: number) =>
    act(async () => {
      root.render(<FooterMarkItem view={FeedViewType.Articles} insertedBefore={insertedBefore} />)
    })
  const button = () => container.querySelector("button")!

  await render(1000)
  await act(async () => button().click())
  expect(button().disabled).toBe(true)

  await render(1000)
  expect(button().disabled).toBe(true)

  await render(2000)
  expect(button().disabled).toBe(false)
  await act(async () => root.unmount())
})
