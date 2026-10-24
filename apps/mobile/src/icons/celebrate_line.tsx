import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface CelebrateLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const CelebrateLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: CelebrateLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="m14.182 9.818l1.06-1.06m-3.535-.708s1.414-2.828.707-4.95m3.182 9.546s2.475-.353 4.243.707m-2.475-6.717l.707-.707m.354 3.889h.707M7.465 8.05l8.485 8.486l-11.402 4.2a1 1 0 0 1-1.284-1.284z"
      />
    </Svg>
  )
}
