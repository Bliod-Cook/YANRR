import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Magic2FillIconProps {
  width?: number
  height?: number
  color?: string
}

export const Magic2FillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Magic2FillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
        d="m6.045 6.05l1.413 1.413M12 12l8.187 8.192M15.944 6.05l-1.411 1.412m-7.071 7.07L6.045 15.95M17.995 11h-2.05m-9.9 0h-2.05m7 7v-2.05m0-9.9V4"
      />
    </Svg>
  )
}
