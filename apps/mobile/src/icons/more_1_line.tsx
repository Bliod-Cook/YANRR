import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface More1LineIconProps {
  width?: number
  height?: number
  color?: string
}

export const More1LineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: More1LineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12.5 12a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0m6 0a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0m-12 0a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0"
      />
      <Path
        fill="none"
        stroke={color}
        strokeWidth={2}
        d="M12.5 12a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0Zm6 0a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0Zm-12 0a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0Z"
      />
    </Svg>
  )
}
