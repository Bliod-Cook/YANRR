import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface BubbleFillIconProps {
  width?: number
  height?: number
  color?: string
}

export const BubbleFillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: BubbleFillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M19 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0m-8-3a4 4 0 1 1-8 0a4 4 0 0 1 8 0m10-7a5 5 0 1 1-10 0a5 5 0 0 1 10 0"
      />
    </Svg>
  )
}
