import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface SafetyCertificateLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const SafetyCertificateLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: SafetyCertificateLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="m8.36 12.166l2.475 2.475l5.305-5.305M8.422 19.21l3.354 1.677a.5.5 0 0 0 .448 0l3.354-1.677A8 8 0 0 0 20 12.056V6.693a1 1 0 0 0-.649-.936l-7-2.625a1 1 0 0 0-.702 0l-7 2.625A1 1 0 0 0 4 6.693v5.363a8 8 0 0 0 4.422 7.155"
      />
    </Svg>
  )
}
