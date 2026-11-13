// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"

import { InternalNavigationHeader } from "./NavigationHeader"

const mocks = vi.hoisted(() => ({
  withTiming: vi.fn((value: number) => value),
  sharedValues: [] as Array<{ value: unknown }>,
}))

vi.mock("@follow/utils", () => ({ cn: () => "" }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("react-native", () => {
  const View = ({ children, ref }: { children?: React.ReactNode; ref?: React.Ref<unknown> }) => {
    React.useImperativeHandle(
      ref,
      () => ({ measure: (callback: (...args: number[]) => void) => callback(0, 0, 0, 0) }),
      [],
    )
    return <div>{children}</div>
  }
  return { View, Pressable: View, StyleSheet: { absoluteFill: {}, hairlineWidth: 1 } }
})
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native")
  return {
    default: { View },
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef<{ value: unknown } | null>(null)
      if (!ref.current) {
        ref.current = { value: initial }
        mocks.sharedValues.push(ref.current)
      }
      return ref.current
    },
    useAnimatedReaction: () => {},
    useAnimatedRef: () => React.useRef(null),
    useAnimatedStyle: (style: () => unknown) => style(),
    withTiming: mocks.withTiming,
  }
})
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ width: 400, height: 800 }),
}))
vi.mock("react-native-uikit-colors", () => ({ useColor: () => "black" }))
vi.mock("@/src/lib/navigation/hooks", () => ({
  useCanBack: () => false,
  useCanDismiss: () => false,
  useIsTopRouteInGroup: () => true,
  useNavigation: () => ({}),
  useScreenIsInSheetModal: () => false,
}))
vi.mock("@/src/lib/navigation/ScreenItemContext", () => ({
  ScreenItemContext: React.createContext({ reAnimatedScrollY: { value: 0 } }),
}))
vi.mock("@/src/lib/navigation/unsaved-changes", () => ({ confirmLeaveWithUnsavedChanges: vi.fn() }))
vi.mock("@/src/lib/window-controls", () => ({
  useHeaderWindowControlsInsets: () => ({ left: 0, right: 0 }),
}))
vi.mock("@/src/icons/close_cute_re", () => ({ CloseCuteReIcon: () => null }))
vi.mock("@/src/icons/mingcute_left_line", () => ({ MingcuteLeftLineIcon: () => null }))
vi.mock("../../common/ThemedBlurView", () => ({ ThemedBlurView: () => null }))
vi.mock("../../ui/loading/PlatformActivityIndicator", () => ({
  PlatformActivityIndicator: () => null,
}))
vi.mock("../utils", () => ({
  getNavigationHeaderLayout: () => ({ headerHeight: 40, headerTopInset: 0 }),
}))
vi.mock("../views/NavigationHeaderContext", () => ({
  SetNavigationHeaderHeightContext: React.createContext(null),
}))
vi.mock("./FakeNativeHeaderTitle", () => ({ FakeNativeHeaderTitle: () => null }))

afterEach(() => vi.unstubAllGlobals())

test("retains the specified selector height when a hidden tab measures zero", async () => {
  vi.stubGlobal("React", React)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const root = createRoot(document.createElement("div"))
  try {
    await act(() =>
      root.render(<InternalNavigationHeader hideableBottom={<div />} hideableBottomHeight={58} />),
    )
    expect(mocks.sharedValues[2]?.value).toBe(98)
    expect(mocks.sharedValues[3]?.value).toBe(98)
  } finally {
    await act(() => root.unmount())
  }
})
