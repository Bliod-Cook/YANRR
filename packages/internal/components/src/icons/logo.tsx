import * as React from "react"

// The letter mark of apps/desktop/layer/renderer/public/icon.svg, on a 1024 × 1024 canvas
export const LOGO_BACKGROUND = "#1F2937"
export const LOGO_SHAPE_PATH =
  "M224 0h576a224 224 0 0 1 224 224v576a224 224 0 0 1-224 224H224A224 224 0 0 1 0 800V224A224 224 0 0 1 224 0Z"
export const LOGO_GLYPH_PATH = "M250 260h170l92 147.6 92-147.6h170L587 560v204H437V560Z"

export const Logo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" {...props}>
    <title>Yanrr</title>
    <path fill={LOGO_BACKGROUND} d={LOGO_SHAPE_PATH} />
    <path fill="#fff" d={LOGO_GLYPH_PATH} />
  </svg>
)
