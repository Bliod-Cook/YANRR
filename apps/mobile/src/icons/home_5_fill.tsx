import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Home5FillIconProps {
  width?: number
  height?: number
  color?: string
}

export const Home5FillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Home5FillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M13.228 2.688a2 2 0 0 0-2.456 0l-8.384 6.52C1.636 9.795 2.05 11 3.003 11h1.092l.82 8.199a2 2 0 0 0 1.99 1.8h10.19a2 2 0 0 0 1.99-1.8l.82-8.2h1.092c.952 0 1.368-1.205.615-1.79zM12 16a3 3 0 1 0 0-6a3 3 0 0 0 0 6"
        clipRule="evenodd"
      />
    </Svg>
  )
}
