import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface BlackBoard2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const BlackBoard2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: BlackBoard2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 12h6m-6 4h2M8 8l3.293-3.293a1 1 0 0 1 1.414 0L16 8M5 20h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1"
      />
    </Svg>
  )
}
