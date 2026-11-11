import type { ViewProps } from "react-native"

import type { ItemPressableStyle } from "./enum"

/** What both platforms implement: iOS uses a native view, which takes no other press props */
export interface ItemPressableProps extends ViewProps {
  itemStyle?: ItemPressableStyle
  touchHighlight?: boolean
  onPress?: () => void
}
