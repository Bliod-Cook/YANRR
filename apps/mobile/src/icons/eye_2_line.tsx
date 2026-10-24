import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Eye2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Eye2LineIcon = ({ width = 24, height = 24, color = "#10161F" }: Eye2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeWidth={2}
        d="M21 12c0 1.5-4.03 6-9 6s-9-4.5-9-6s4.03-6 9-6s9 4.5 9 6Z"
      />
      <Path fill="none" stroke={color} strokeWidth={2} d="M14 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0Z" />
    </Svg>
  )
}
