import * as React from "react"
import Svg, { Path } from "react-native-svg"

interface BlackBoard2FillIconProps {
  width?: number
  height?: number
  color?: string
}

export const BlackBoard2FillIcon = ({
  width = 24,
  height = 24,
  color = "#10161F",
}: BlackBoard2FillIconProps) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M10.586 4a2 2 0 0 1 2.828 0l3 3H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.586zM8 15a1 1 0 0 0 0 2h2a1 1 0 0 0 0-2zm0-4a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2zm2.414-4h3.172L12 5.414z"
      />
    </Svg>
  )
}
