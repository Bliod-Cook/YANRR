import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Download2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Download2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Download2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 16v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4m8-13v12m-4.243-3.586L12 15.657l4.243-4.243"
      />
    </Svg>
  )
}
