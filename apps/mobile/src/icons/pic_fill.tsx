import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface PicFillIconProps {
  width?: number
  height?: number
  color?: string
}

export const PicFillIcon = ({ width = 24, height = 24, color = "#10161F" }: PicFillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm18 0H4v11.1l5.172-5.171a1 1 0 0 1 1.414 0l4.242 4.243l1.415-1.415a1 1 0 0 1 1.414 0L20 16.101zm-6 3.5a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0"
        clipRule="evenodd"
      />
    </Svg>
  )
}
