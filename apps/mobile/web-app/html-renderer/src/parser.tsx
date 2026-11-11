import type { SpotlightRule } from "@follow/shared/spotlight"
import { resolveContentUrl } from "@follow/utils/content-url"
import { parseHtml as parseHtmlGeneral } from "@follow/utils/html"
import type { Parent } from "hast"
import type { Components } from "hast-util-to-jsx-runtime"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { createHeadingRenderer, MarkdownLink, MarkdownP } from "./components"
import { MarkdownImage } from "./components/image"
import { Math } from "./components/math"
import { ShikiHighLighter } from "./components/shiki"
import { getYouTubeEmbedVideoId, YouTubeEmbedCard } from "./components/youtube-embed"
import { applySpotlightToHtmlRendererTree } from "./spotlight"

// As children, React writes the text as text: the style never parses into markup
const renderStyleTag: Components["style"] = ({ node, ...props }) => {
  if (typeof props.children === "string") {
    return createElement("style", null, props.children)
  }
  return null
}

const urlProperties: Record<string, string[]> = {
  a: ["href"],
  img: ["src"],
  video: ["src", "poster"],
  source: ["src"],
  iframe: ["src"],
}

/** The page itself is a local file, so relative addresses only work once made absolute */
const resolveUrls = (parent: Parent, base: string | undefined) => {
  for (const child of parent.children) {
    if (child.type !== "element") continue
    for (const property of urlProperties[child.tagName] ?? []) {
      const value = child.properties[property]
      if (typeof value === "string") {
        child.properties[property] = resolveContentUrl(value, base)
      }
    }
    resolveUrls(child, base)
  }
}

export const parseHtml = (
  content: string,
  options?: Partial<{
    renderInlineStyle: boolean
    noMedia?: boolean
    spotlightRules?: SpotlightRule[]
    coverImageUrl?: string
    baseUrl?: string
  }>,
) => {
  const spotlightRules = options?.spotlightRules ?? []

  return parseHtmlGeneral(content, {
    ...options,
    hastTransform: (tree) => {
      resolveUrls(tree, options?.baseUrl)
      applySpotlightToHtmlRendererTree(tree, spotlightRules)
    },
    components: {
      a: ({ node, ...props }) => {
        // Ignore link wrapper when child is an image to ensure image preview
        // works instead of navigating to the link URL when clicked
        //
        // Check if the link contains only an image as a child
        if (
          node.children &&
          node.children.length === 1 &&
          node.children[0].type === "element" &&
          node.children[0].tagName === "img"
        ) {
          // Return only the image element
          return props.children
        }
        return createElement(MarkdownLink, props)
      },

      h1: (props) => {
        return createHeadingRenderer(1)(props)
      },
      h2: (props) => {
        return createHeadingRenderer(2)(props)
      },
      h3: (props) => {
        return createHeadingRenderer(3)(props)
      },
      h4: (props) => {
        return createHeadingRenderer(4)(props)
      },
      h5: (props) => {
        return createHeadingRenderer(5)(props)
      },
      h6: (props) => {
        return createHeadingRenderer(6)(props)
      },
      style: renderStyleTag,
      img: ({ node, ...props }) => {
        return createElement(MarkdownImage, props)
      },

      p: ({ node, ...props }) => {
        if (node?.children && node.children.length !== 1) {
          for (const item of node.children) {
            item.type === "element" &&
              item.tagName === "img" &&
              ((item.properties as any).inline = true)
          }
        }
        return createElement(MarkdownP, props, props.children)
      },

      // The sandbox comes from the sanitizer, whatever the article set
      iframe: ({ node, ...props }) => {
        if (!props.src) return null
        const videoId = getYouTubeEmbedVideoId(props.src)
        if (videoId) {
          return createElement(YouTubeEmbedCard, { videoId, title: props.title })
        }
        return createElement("iframe", props)
      },
      math: Math,
      hr: ({ node, ...props }) =>
        createElement("hr", {
          ...props,
          className: "scale-x-50",
        }),
      // The sanitizer lets only disabled checkboxes through, for task lists
      input: ({ node, ...props }) => createElement("input", { ...props, className: "mr-2" }),
      pre: ({ node, ...props }) => {
        if (!props.children) return null

        let language = ""

        let codeString = null as string | null
        if (props.className?.includes("language-")) {
          language = props.className.replace("language-", "")
        }

        if (typeof props.children !== "object") {
          codeString = props.children.toString()
        } else {
          const propsChildren = props.children
          const children = Array.isArray(propsChildren)
            ? propsChildren.find((i) => i.type === "code")
            : propsChildren

          // Don't process not code block
          if (!children) return createElement("pre", props, props.children)

          if (
            "type" in children &&
            children.type === "code" &&
            children.props.className?.includes("language-")
          ) {
            language = children.props.className.replace("language-", "")
          }
          const code = ("props" in children && children.props.children) || children
          if (!code) return null

          try {
            codeString = extractCodeFromHtml(renderToString(code))
          } catch (error) {
            console.error("Code Block Render Error", error)
            return createElement("pre", props, props.children)
          }
        }

        if (!codeString) return createElement("pre", props, props.children)

        return createElement(ShikiHighLighter, {
          code: codeString.trimEnd(),
          language: language.toLowerCase(),
        })
      },
      figure: ({ node, ...props }) =>
        createElement(
          "figure",
          {
            className: "mx-auto max-w-full",
            style: {
              marginLeft: "auto",
              marginRight: "auto",
              ...(props as any).style,
            },
          },
          props.children,
        ),
      table: ({ node, ...props }) =>
        createElement(
          "div",
          {
            className: "w-full overflow-x-auto",
          },

          createElement("table", {
            ...props,
            className: "w-full my-0",
          }),
        ),
      video: ({ node, ...props }) =>
        createElement("video", {
          ...props,
          controls: true,
        }),
    },
  })
}
function extractCodeFromHtml(htmlString: string) {
  const tempDiv = document.createElement("div")
  tempDiv.innerHTML = htmlString

  const hasPre = tempDiv.querySelector("pre")
  if (!hasPre) {
    tempDiv.innerHTML = `<pre><code>${htmlString}</code></pre>`
  }

  // 1. line break via <div />
  const divElements = tempDiv.querySelectorAll("div")

  let code = ""

  if (divElements.length > 0) {
    divElements.forEach((div) => {
      if (!div.querySelector("div")) {
        code += `${div.textContent}\n`
      }
    })
    return code
  }

  // 2. line wrapper like <span><span>...</span></span>
  const spanElements = tempDiv.querySelectorAll("span > span")

  // 2.1 outside <span /> as a line break?

  let spanAsLineBreak = false

  if (tempDiv.children.length > 2) {
    for (const node of tempDiv.children) {
      const span = node as HTMLSpanElement
      // 2.2 If the span has only one child and it's a line break, then span can be as a line break
      spanAsLineBreak = span.children.length === 1 && span.childNodes.item(0).textContent === "\n"
      if (spanAsLineBreak) break
    }
  }

  if (!spanAsLineBreak) {
    const usingBr = tempDiv.querySelector("br")
    if (usingBr) {
      spanAsLineBreak = true
    }
  }

  if (spanElements.length > 0) {
    for (const node of tempDiv.children) {
      if (spanAsLineBreak) {
        code += `${node.textContent}`
      } else {
        code += `${node.textContent}\n`
      }
    }

    return code
  }

  return tempDiv.textContent
}
