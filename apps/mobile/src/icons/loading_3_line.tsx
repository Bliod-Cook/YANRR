import * as React from "react"
import Svg, { Circle, Path } from "react-native-svg"

interface Loading3LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Loading3LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Loading3LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={2} opacity={0.1} />
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
        d="M12 3a8.96 8.96 0 0 0-6.225 2.5"
      />
    </Svg>
  )
}
