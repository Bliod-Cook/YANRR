import type { FC } from "react"
import type { ViewProps } from "react-native"

export type Tab = {
  name: string
  activeColor?: string
  value: string
}

export type TabComponent<T extends {} = {}> = FC<
  { isSelected: boolean; tab: Tab } & T & Pick<ViewProps, "onLayout">
>
