import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface RightFillIconProps {
  width?: number
  height?: number
  color?: string
}

export const RightFillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: RightFillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
        d="M9.343 6.343L15 12l-5.657 5.657"
      />
    </Svg>
  )
}
