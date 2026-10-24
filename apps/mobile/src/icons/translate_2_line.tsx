import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Translate2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Translate2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Translate2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h10M9 4v2m3 0c0 4-3 8-8 10m2.559-7c.985 2.628 3.237 5.024 6.441 6.561M11 20l4.5-10L20 20m-7.65-3h6.3"
      />
    </Svg>
  )
}
