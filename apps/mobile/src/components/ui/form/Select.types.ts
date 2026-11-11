import type { StyleProp, ViewStyle } from "react-native"

/** Both platforms' select, which shows `value` and only reports a choice */
export interface SelectProps<T> {
  options: {
    label: string
    value: T
    subLabel?: string
  }[]
  value: T
  onValueChange: (value: T) => void
  displayValue?: string
  wrapperClassName?: string
  wrapperStyle?: StyleProp<ViewStyle>
  label?: string
  disabled?: boolean
}
