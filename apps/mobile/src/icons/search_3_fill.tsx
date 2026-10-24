import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Search3FillIconProps {
  width?: number
  height?: number
  color?: string
}

export const Search3FillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Search3FillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M10.5 2a8.5 8.5 0 0 1 8.5 8.5a8.46 8.46 0 0 1-1.826 5.26l3.654 3.654a1 1 0 1 1-1.414 1.414l-3.654-3.654A8.46 8.46 0 0 1 10.5 19a8.5 8.5 0 0 1 0-17m0 4a1 1 0 0 0 0 2a2.5 2.5 0 0 1 2.5 2.5a1 1 0 1 0 2 0A4.5 4.5 0 0 0 10.5 6"
      />
    </Svg>
  )
}
