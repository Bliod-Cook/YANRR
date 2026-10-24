import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface DocmentLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const DocmentLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: DocmentLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
        d="M9 9h6m-6 5h3m-6 7h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1Z"
      />
    </Svg>
  )
}
