import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface StopCircleFillIconProps {
  width?: number
  height?: number
  color?: string
}

export const StopCircleFillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: StopCircleFillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2m-2 6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z"
      />
    </Svg>
  )
}
