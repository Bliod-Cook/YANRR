import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface NotificationLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const NotificationLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: NotificationLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17a3 3 0 1 1-6 0M6 9v3.528a2 2 0 0 1-.211.894l-1.717 3.433a.1.1 0 0 0 .09.145h15.676a.1.1 0 0 0 .09-.145l-1.717-3.433a2 2 0 0 1-.211-.894V9A6 6 0 0 0 6 9Z"
      />
    </Svg>
  )
}
