import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Search2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Search2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Search2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
        d="M14.5 14.5L20 20m-4-10a6 6 0 1 1-12 0a6 6 0 0 1 12 0Z"
      />
    </Svg>
  )
}
