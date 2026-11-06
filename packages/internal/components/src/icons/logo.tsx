import * as React from "react"

// The mark of apps/desktop/layer/renderer/public/icon.svg, on a 1024 × 1024 canvas
export const LOGO_BACKGROUND = "#FF5C00"
export const LOGO_SHAPE_PATH =
  "M224 0h576a224 224 0 0 1 224 224v576a224 224 0 0 1-224 224H224A224 224 0 0 1 0 800V224A224 224 0 0 1 224 0Z"
export const LOGO_GLYPH_PATH =
  "M317 263H401.9A24 24 0 0 1 425.8 285.3A316 316 0 0 0 718.7 578.2A24 24 0 0 1 741 602.1V727A76 76 0 0 1 665 803H317A76 76 0 0 1 241 727V339A76 76 0 0 1 317 263ZM675 263A66 66 0 1 1 807 263A66 66 0 1 1 675 263ZM741 525A262 262 0 0 1 479 263A37 37 0 0 1 553 263A188 188 0 0 0 741 451A37 37 0 0 1 741 525Z"

export const Logo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" {...props}>
    <title>Yanrr</title>
    <path fill={LOGO_BACKGROUND} d={LOGO_SHAPE_PATH} />
    <path fill="#fff" d={LOGO_GLYPH_PATH} />
  </svg>
)
