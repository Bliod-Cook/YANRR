import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Settings1LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Settings1LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Settings1LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path fill="none" stroke={color} strokeWidth={2} d="M15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0Z" />
      <Path
        fill="none"
        stroke={color}
        strokeWidth={2}
        d="M10.5 3.628a3 3 0 0 1 3 0l5 2.887A3 3 0 0 1 20 9.113v5.773a3 3 0 0 1-1.5 2.598l-5 2.887a3 3 0 0 1-3 0l-5-2.887A3 3 0 0 1 4 14.886V9.113a3 3 0 0 1 1.5-2.598z"
      />
    </Svg>
  )
}
