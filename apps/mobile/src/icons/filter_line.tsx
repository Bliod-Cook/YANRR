import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface FilterLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const FilterLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: FilterLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19.5 4h-15a.5.5 0 0 0-.5.5v2.086a1 1 0 0 0 .293.707L10 13v5.691a.5.5 0 0 0 .276.447L14 21v-8l5.707-5.707A1 1 0 0 0 20 6.586V4.5a.5.5 0 0 0-.5-.5Z"
      />
    </Svg>
  )
}
