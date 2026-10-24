import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface ArrowLeftLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const ArrowLeftLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: ArrowLeftLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 12h15m-10 5.657L4.343 12L10 6.343"
      />
    </Svg>
  )
}
