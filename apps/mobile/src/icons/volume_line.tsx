import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface VolumeLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const VolumeLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: VolumeLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 9.764A3 3 0 0 1 18 12c0 .888-.386 1.687-1 2.236m2-6.708A6 6 0 0 1 21 12a6 6 0 0 1-2 4.472M14 4v16l-6.74-4.814A1 1 0 0 0 6.68 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2.68a1 1 0 0 0 .58-.186z"
      />
    </Svg>
  )
}
