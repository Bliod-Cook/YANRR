import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface AlertFillIconProps {
  width?: number
  height?: number
  color?: string
}

export const AlertFillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: AlertFillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M10.7 3.148a1.5 1.5 0 0 1 2.6 0l8.633 14.954a1.5 1.5 0 0 1-1.299 2.25H3.366a1.5 1.5 0 0 1-1.299-2.25zM12 15.001a1 1 0 1 0 0 2a1 1 0 0 0 0-2m0-7a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1"
      />
    </Svg>
  )
}
