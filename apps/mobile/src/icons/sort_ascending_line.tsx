import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface SortAscendingLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const SortAscendingLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: SortAscendingLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18 19V5m-2.828 2L18 4.172L20.828 7M4 12h9m-9 7h9M4 5h7"
      />
    </Svg>
  )
}
