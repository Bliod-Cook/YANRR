import { LazyKateX } from "@follow/components/ui/katex/lazy.js"
import katexStyle from "katex/dist/katex.min.css?inline"
import { createElement, Fragment, use } from "react"

import { IsInParagraphContext } from "./__internal/ctx"

export const Math = ({ node }: { node: any }) => {
  const annotation = node.children.at(-1)

  const isInParagraph = use(IsInParagraphContext)
  if (!annotation) return null
  const latex = annotation.value

  return createElement(
    Fragment,
    null,
    // With href and precedence React puts the styles in the head once, however many formulas
    createElement("style", { href: "katex", precedence: "default" }, katexStyle),
    createElement(LazyKateX, {
      children: latex,
      mode: isInParagraph ? "inline" : "display",
    }),
  )
}
