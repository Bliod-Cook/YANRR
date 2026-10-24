import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Copy2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Copy2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Copy2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeWidth={2}
        d="M8 6V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2M4 21h11a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1Z"
      />
    </Svg>
  )
}
