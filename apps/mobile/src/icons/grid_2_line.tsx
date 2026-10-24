import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Grid2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Grid2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Grid2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1zM10 5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1zm10 8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1zm-10 4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1z"
      />
    </Svg>
  )
}
