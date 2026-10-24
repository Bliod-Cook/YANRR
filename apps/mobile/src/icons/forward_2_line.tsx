import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Forward2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const Forward2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Forward2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 15.5a8.5 8.5 0 0 1 16.456-3m-5.735-.542L19.63 13l1.042-5.909"
      />
    </Svg>
  )
}
