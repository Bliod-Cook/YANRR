import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface Settings1FillIconProps {
  width?: number
  height?: number
  color?: string
}

export const Settings1FillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: Settings1FillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M10 2.762a4 4 0 0 1 4 0l5 2.887a4 4 0 0 1 2 3.464v5.774a4 4 0 0 1-2 3.463l-5 2.887a4 4 0 0 1-4 0L5 18.35a4 4 0 0 1-2-3.464V9.114A4 4 0 0 1 5 5.65zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6"
      />
    </Svg>
  )
}
