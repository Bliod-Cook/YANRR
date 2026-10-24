import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface CloseLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const CloseLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: CloseLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
        d="m5.636 5.637l12.728 12.728m-12.728 0L18.364 5.637"
      />
    </Svg>
  )
}
