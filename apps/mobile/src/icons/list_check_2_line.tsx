import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface ListCheck2LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const ListCheck2LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: ListCheck2LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5h9m-9 7h9m-9 7h9M7.945 3.72L5.47 6.195L4.055 4.78m3.89 5.94L5.47 13.195L4.055 11.78m3.89 5.94L5.47 20.195L4.055 18.78"
      />
    </Svg>
  )
}
