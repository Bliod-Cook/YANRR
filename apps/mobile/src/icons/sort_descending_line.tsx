import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface SortDescendingLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const SortDescendingLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: SortDescendingLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18 5v14m-2.828-2L18 19.828L20.828 17M4 12h9M4 5h9M4 19h7"
      />
    </Svg>
  )
}
