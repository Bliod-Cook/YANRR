// @vitest-environment happy-dom
import type { FeedViewType } from "@follow/constants"
import { EventBus } from "@follow/utils/event-bus"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { LayoutChangeEvent } from "react-native"
import { afterEach, expect, test, vi } from "vitest"

import { PagerList } from "./PagerList"

const mocks = vi.hoisted(() => ({
  focused: false,
  selected: { type: "view" as const, viewId: 0 as FeedViewType },
  views: [0, 1, 2, 3],
  progress: { set: vi.fn() },
  setPage: vi.fn(),
  setPageWithoutAnimation: vi.fn(),
  onLayout: undefined as ((event: LayoutChangeEvent) => void) | undefined,
}))

vi.mock("@follow/store/subscription/hooks", () => ({
  useViewWithSubscription: () => mocks.views,
}))
vi.mock("@/src/lib/navigation/bottom-tab/hooks", () => ({
  useTabScreenIsFocused: () => mocks.focused,
}))
vi.mock("./atoms", () => ({
  useSelectedFeed: () => mocks.selected,
  useTimelineSelectorDragProgress: () => mocks.progress,
  selectTimeline: vi.fn(),
}))
vi.mock("expo-haptics", () => ({}))
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: () => null,
}))
vi.mock("react-native-reanimated", () => ({
  default: { createAnimatedComponent: (component: unknown) => component },
  useHandler: () => ({ doDependenciesDiffer: false }),
  useEvent: () => () => {},
}))
vi.mock("react-native-pager-view", async () => {
  const { useImperativeHandle } = await import("react")
  return {
    default: function MockPagerView(props: {
      ref: React.Ref<{
        setPage: typeof mocks.setPage
        setPageWithoutAnimation: typeof mocks.setPageWithoutAnimation
      }>
      onLayout?: (event: LayoutChangeEvent) => void
    }) {
      mocks.onLayout = props.onLayout
      useImperativeHandle(props.ref, () => ({
        setPage: mocks.setPage,
        setPageWithoutAnimation: mocks.setPageWithoutAnimation,
      }))
      return null
    },
  }
})

afterEach(() => vi.unstubAllGlobals())

test("animates only a visible, laid-out pager and synchronizes its page when revealed", async () => {
  vi.stubGlobal("React", React)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const root = createRoot(document.createElement("div"))
  const render = () => root.render(<PagerList renderItem={() => null} />)
  const select = (viewId: FeedViewType) =>
    EventBus.dispatch("SELECT_TIMELINE", { view: { type: "view", viewId }, target: "other" })
  const layout = (width: number) =>
    mocks.onLayout?.({
      nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } },
    } as LayoutChangeEvent)

  try {
    await act(render)
    await act(() => select(1))
    expect(mocks.setPage).not.toHaveBeenCalled()

    mocks.focused = true
    mocks.selected.viewId = 1
    await act(render)
    await act(() => select(2))
    expect(mocks.setPage).not.toHaveBeenCalled()

    await act(() => layout(400))
    expect(mocks.setPageWithoutAnimation).toHaveBeenLastCalledWith(1)
    await act(() => select(2))
    expect(mocks.setPage).toHaveBeenCalledExactlyOnceWith(2)

    mocks.focused = false
    await act(render)
    await act(() => layout(0))
    await act(() => select(0))
    expect(mocks.setPage).toHaveBeenCalledTimes(1)

    mocks.selected.viewId = 3
    await act(render)
    // Native layout can arrive before the screen's appear event.
    await act(() => layout(400))
    expect(mocks.setPageWithoutAnimation).toHaveBeenLastCalledWith(3)
    mocks.focused = true
    await act(render)
    await act(() => select(0))
    expect(mocks.setPage).toHaveBeenLastCalledWith(0)
  } finally {
    await act(() => root.unmount())
  }
})
