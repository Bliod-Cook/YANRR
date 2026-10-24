import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface PauseFillIconProps {
  width?: number
  height?: number
  color?: string
}

export const PauseFillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: PauseFillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M14 4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1zM6 4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"
      />
    </Svg>
  )
}
