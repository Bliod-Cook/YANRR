import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface StarFillIconProps {
  width?: number
  height?: number
  color?: string
}

export const StarFillIcon = ({ width = 24, height = 24, color = "#10161F" }: StarFillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M10.92 2.37a1.25 1.25 0 0 1 2.16 0l2.795 4.8l5.428 1.175a1.25 1.25 0 0 1 .667 2.054l-3.7 4.142l.56 5.525a1.25 1.25 0 0 1-1.748 1.27L12 19.096l-5.082 2.24a1.25 1.25 0 0 1-1.747-1.27l.559-5.525l-3.7-4.142a1.25 1.25 0 0 1 .667-2.054L8.125 7.17z"
      />
    </Svg>
  )
}
