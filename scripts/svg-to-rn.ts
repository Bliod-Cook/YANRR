// Generates React Native components from the open-source MingCute set.
// Usage: pnpm icons:sync add-fill search-3-line
import fs from "node:fs"

import { icons } from "@iconify-json/mingcute"
import path from "pathe"
import { format, resolveConfig } from "prettier"
import { parse } from "svg-parser"

const DIST_DIR = "apps/mobile/src/icons"

const DEFAULT_COLOR = "#10161F"
interface SvgNode {
  type: string
  tagName: string
  properties: Record<string, any>
  children?: SvgNode[]
}

const toComponentTag = (tagName: string) => `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}`

const generateElement = (node: SvgNode): string => {
  const props = Object.entries(node.properties)
    .map(([key, value]) => {
      const camelKey = key.replaceAll(/-([a-z])/g, (_match, p1: string) => p1.toUpperCase())

      if (["stroke", "fill"].includes(key) && value === "currentColor") {
        return `${camelKey}={color}`
      }

      if (typeof value === "number") {
        return `${camelKey}={${value}}`
      }

      return `${camelKey}="${value}"`
    })
    .join(" ")

  return `      <${toComponentTag(node.tagName)} ${props} />`
}

const supportedTags = new Set(["path", "circle"])

const convertSvgToRN = (svgContent: string, componentName: string) => {
  const ast = parse(svgContent)
  const svgNode = ast.children[0] as SvgNode
  const { width, height } = svgNode.properties

  const elements = svgNode.children?.filter((child) => supportedTags.has(child.tagName)) ?? []
  const pathElements = elements.map((node) => generateElement(node)).join("\n")
  const svgComponents = [...new Set(elements.map((node) => toComponentTag(node.tagName)))]

  return `import * as React from "react"
import Svg, { ${svgComponents.sort().join(", ")} } from "react-native-svg"

interface ${componentName}Props {
  width?: number
  height?: number
  color?: string
}

export const ${componentName} = ({
  width = ${width},
  height = ${height},
  ${pathElements.includes(`{color}`) ? `color = "${DEFAULT_COLOR}",` : ""}
}: ${componentName}Props) => {
  return (
    <Svg width={width} height={height} fill="none" viewBox="0 0 ${width} ${height}">
${pathElements}
    </Svg>
  )
}
`
}

const processIcon = async (iconName: string) => {
  const icon = icons.icons[iconName]
  if (!icon) {
    throw new Error(`Unknown MingCute icon: ${iconName}`)
  }

  const { width = icons.width, height = icons.height } = icon
  const svgContent = `<svg width="${width}" height="${height}">${icon.body}</svg>`
  const fileName = iconName.replaceAll("-", "_")
  const componentName = `${fileName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}Icon`

  const outputPath = path.join(process.cwd(), DIST_DIR, `${fileName}.tsx`)
  const prettierConfig = await resolveConfig(outputPath)
  const rnComponent = await format(convertSvgToRN(svgContent, componentName), {
    ...prettierConfig,
    filepath: outputPath,
  })

  fs.writeFileSync(outputPath, rnComponent)
  console.log(`Generated ${outputPath}`)
}

for (const iconName of process.argv.slice(2)) {
  await processIcon(iconName)
}
