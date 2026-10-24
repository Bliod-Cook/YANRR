import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface SafeAlertLineIconProps {
  width?: number
  height?: number
  color?: string
}

export const SafeAlertLineIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: SafeAlertLineIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
        d="M12 8v4m0 3h.002m-3.58 4.211l3.354 1.677a.5.5 0 0 0 .448 0l3.354-1.677A8 8 0 0 0 20 12.056V6.693a1 1 0 0 0-.649-.936l-7-2.625a1 1 0 0 0-.702 0l-7 2.625A1 1 0 0 0 4 6.693v5.363a8 8 0 0 0 4.422 7.155Z"
      />
    </Svg>
  )
}
