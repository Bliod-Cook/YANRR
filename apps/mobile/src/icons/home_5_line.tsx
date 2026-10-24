import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Home5LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Home5LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Home5LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3.005 9.998v-.002l8.381-6.518a1 1 0 0 1 1.228 0l8.381 6.518v.002L19 10l-.91 9.1a1 1 0 0 1-.995.9H6.905a1 1 0 0 1-.995-.9L5 10z"
      />
      <Path
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
        d="M14.5 13a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0Z"
      />
    </Svg>
  )
}
