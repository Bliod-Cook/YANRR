import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface AddLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const AddLineIcon = ({ width = 24, height = 24, color = "#10161F" }: AddLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path fill="none" stroke={color} strokeLinecap="round" strokeWidth={2} d="M5 12h14m-7 7V5" />
    </Svg>
  )
}
