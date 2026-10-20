import {
  LOGO_BACKGROUND,
  LOGO_GLYPH_PATH,
  LOGO_SHAPE_PATH,
} from "@follow/components/icons/logo.tsx"
import type { SvgProps } from "react-native-svg"
import Svg, { Path } from "react-native-svg"

export const Logo: React.FC<SvgProps> = (props) => (
  <Svg viewBox="0 0 1024 1024" {...props}>
    <Path fill={LOGO_BACKGROUND} d={LOGO_SHAPE_PATH} />
    <Path fill="#fff" d={LOGO_GLYPH_PATH} />
  </Svg>
)
