import * as React from "react"

// The mark of apps/desktop/layer/renderer/public/icon.svg, on a 1024 × 1024 canvas
export const LOGO_BACKGROUND = "#FF5C00"
export const LOGO_SHAPE_PATH =
  "M224 0h576a224 224 0 0 1 224 224v576a224 224 0 0 1-224 224H224A224 224 0 0 1 0 800V224A224 224 0 0 1 224 0Z"
export const LOGO_GLYPH_PATH =
  "M335 243H419.9A24 24 0 0 1 443.8 265.3A316 316 0 0 0 736.7 558.2A24 24 0 0 1 759 582.1V707A76 76 0 0 1 683 783H335A76 76 0 0 1 259 707V319A76 76 0 0 1 335 243ZM693 243A66 66 0 1 1 825 243A66 66 0 1 1 693 243ZM759 505A262 262 0 0 1 497 243A37 37 0 0 1 571 243A188 188 0 0 0 759 431A37 37 0 0 1 759 505Z"

export const Logo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" {...props}>
    <title>Yanrr</title>
    <path fill={LOGO_BACKGROUND} d={LOGO_SHAPE_PATH} />
    <path fill="#fff" d={LOGO_GLYPH_PATH} />
  </svg>
)
