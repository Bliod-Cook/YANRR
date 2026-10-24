import * as React from "react"
import Svg, { Circle } from "react-native-svg"

interface RoundLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const RoundLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: RoundLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  )
}
