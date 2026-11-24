// Renders every raster app icon from the source SVG; run `pnpm run icons:app` after editing it.
import { readFile, writeFile } from "node:fs/promises"

import { IconIcns, IconIco } from "@shockpkg/icon-encoder"
import path from "pathe"
import type { Sharp } from "sharp"
import sharp from "sharp"

type Variant = "production" | "development" | "staging"

const root = path.resolve(import.meta.dirname, "..")
const desktop = (file: string) => path.join(root, "apps/desktop", file)
const web = (file: string) => path.join(root, "apps/desktop/layer/renderer/public", file)
const mobile = (file: string) => path.join(root, "apps/mobile", file)

const source = await readFile(web("icon.svg"), "utf8")
const pick = (pattern: RegExp) => {
  const match = source.match(pattern)?.[1]
  if (!match) throw new Error(`icon.svg does not match ${pattern}`)
  return match
}
const viewBox = pick(/viewBox="([^"]+)"/)
const glyph = pick(/(<path id="glyph"[^>]*\/>)/)
const background = pick(/<rect id="background"[^>]*fill="([^"]+)"/)

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }
// Development and staging builds carry a colored band along the bottom of the icon
const BAND_COLORS: Record<Exclude<Variant, "production">, string> = {
  development: "#3B82F6",
  staging: "#EAB308",
}
// The macOS icon grid draws the shape at 824 of 1024 pixels
const MACOS_SCALE = 824 / 1024
const ICNS_TYPES = [
  ["ic04", 16],
  ["ic05", 32],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
] as const
const WINDOWS_SIZES = [16, 24, 32, 48, 64, 128, 256]
const TRAY_SIZES = [16, 24, 32, 48, 256]
const FAVICON_SIZES = [16, 32, 48]

const png = (image: Sharp) => image.png().toBuffer()

const rasterize = (svg: string, size: number) =>
  png(sharp(Buffer.from(svg.replace("<svg ", `<svg width="${size}" height="${size}" `))))

const glyphSvg = (color?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${
    color ? glyph.replace(/fill="[^"]*"/, `fill="${color}"`) : glyph
  }</svg>`

const withBand = async (icon: Buffer, size: number, variant: Variant) => {
  if (variant === "production") return icon
  const band = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect y="85" width="100" height="15" fill="${BAND_COLORS[variant]}"/></svg>`
  // "atop" keeps the band inside the icon's shape
  return png(sharp(icon).composite([{ input: await rasterize(band, size), blend: "atop" }]))
}

const centered = async (image: Buffer, size: number) => {
  const { width = size } = await sharp(image).metadata()
  const start = Math.floor((size - width) / 2)
  const end = size - width - start
  return png(
    sharp(image).extend({
      top: start,
      left: start,
      bottom: end,
      right: end,
      background: TRANSPARENT,
    }),
  )
}

/** The rounded square of the SVG, drawn at `scale` of the canvas on a transparent background */
const rounded = async (size: number, { variant = "production" as Variant, scale = 1 } = {}) => {
  const inner = Math.round(size * scale)
  return centered(await withBand(await rasterize(source, inner), inner, variant), size)
}

/** An opaque full-bleed square, for platforms that mask the icon themselves */
const square = async (size: number, variant: Variant = "production") => {
  const icon = await png(
    sharp({ create: { width: size, height: size, channels: 4, background } }).composite([
      { input: await rasterize(glyphSvg(), size) },
    ]),
  )
  return png(sharp(await withBand(icon, size, variant)).removeAlpha())
}

/** The glyph alone in `color`, its longer side taking `scale` of the canvas */
const glyphOnly = async (
  size: number,
  color: string,
  scale: number,
  { preservePosition = false } = {},
) => {
  const box = Math.round(size * scale)
  const svg = glyphSvg(color)
  const { data: trimmed, info: bounds } = await sharp(await rasterize(svg, 1024))
    .trim()
    .png()
    .toBuffer({ resolveWithObject: true })
  if (preservePosition) {
    const inner = Math.round((box * 1024) / Math.max(bounds.width, bounds.height))
    return centered(await rasterize(svg, inner), size)
  }
  return centered(
    await png(sharp(trimmed).resize(box, box, { fit: "contain", background: TRANSPARENT })),
    size,
  )
}

const ico = async (sizes: number[], create: (size: number) => Promise<Buffer>) => {
  const icon = new IconIco()
  for (const size of sizes) await icon.addFromPng(await create(size))
  return Buffer.from(icon.encode())
}

const icns = async (variant: Variant) => {
  const icon = new IconIcns()
  for (const [type, size] of ICNS_TYPES) {
    await icon.addFromPng(await rounded(size, { variant, scale: MACOS_SCALE }), [type])
  }
  return Buffer.from(icon.encode())
}

const outputs: Record<string, () => Promise<Buffer>> = {
  [desktop("resources/icon.png")]: () => rounded(1024, { scale: MACOS_SCALE }),
  [desktop("resources/icon-dev.png")]: () =>
    rounded(1024, { variant: "development", scale: MACOS_SCALE }),
  [desktop("resources/icon-staging.png")]: () =>
    rounded(1024, { variant: "staging", scale: MACOS_SCALE }),
  [desktop("resources/icon.icns")]: () => icns("production"),
  [desktop("resources/icon-staging.icns")]: () => icns("staging"),
  [desktop("resources/icon.ico")]: () => ico(WINDOWS_SIZES, (size) => rounded(size)),
  [desktop("resources/icon-staging.ico")]: () =>
    ico(WINDOWS_SIZES, (size) => rounded(size, { variant: "staging" })),
  // A macOS template image: only its alpha counts
  [desktop("resources/icon-tray.png")]: () => glyphOnly(256, "#000000", 0.875),
  [desktop("resources/icon-tray.ico")]: () => ico(TRAY_SIZES, (size) => rounded(size)),
  [desktop("resources/icon-tray-staging.ico")]: () =>
    ico(TRAY_SIZES, (size) => rounded(size, { variant: "staging" })),
  [desktop("static/dmg-icon.icns")]: () => icns("production"),
  [web("favicon.ico")]: () => ico(FAVICON_SIZES, (size) => rounded(size)),
  [web("favicon-dev.ico")]: () =>
    ico(FAVICON_SIZES, (size) => rounded(size, { variant: "development" })),
  [web("apple-touch-icon-180x180.png")]: () => square(180),
  [web("maskable-icon-512x512.png")]: () => square(512),
  [web("pwa-64x64.png")]: () => rounded(64),
  [web("pwa-192x192.png")]: () => rounded(192),
  [web("pwa-512x512.png")]: () => rounded(512),
  [mobile("assets/icon.png")]: () => square(2048),
  [mobile("assets/icon-dev.png")]: () => square(2048, "development"),
  [mobile("assets/icon-staging.png")]: () => square(2048, "staging"),
  // Android shows the middle 61% of an adaptive icon at most; its background color is set in app.config.base.ts
  [mobile("assets/adaptive-icon.png")]: () =>
    glyphOnly(1024, "#FFFFFF", 0.4, { preservePosition: true }),
  [mobile("assets/splash-icon.png")]: () => rounded(1024, { scale: 0.67 }),
}

for (const [file, create] of Object.entries(outputs)) {
  await writeFile(file, await create())
  console.info(path.relative(root, file))
}
