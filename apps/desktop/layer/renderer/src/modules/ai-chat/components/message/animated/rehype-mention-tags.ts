import type { Element, ElementContent, Root } from "hast"

const MENTION_OPEN_TAG =
  /^<(mention-entry|mention-feed)(?:\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<=>`]+)))?\s*(\/)?>$/i
const MENTION_CLOSE_TAG = /^<\/(mention-entry|mention-feed)\s*>$/i

const closingTagName = (node: ElementContent) =>
  node.type === "raw" ? MENTION_CLOSE_TAG.exec(node.value.trim())?.[1]?.toLowerCase() : undefined

const convertChildren = (parent: Root | Element) => {
  const source = parent.children as ElementContent[]
  const children: ElementContent[] = []

  for (let index = 0; index < source.length; index++) {
    const node = source[index]!
    const open = node.type === "raw" ? MENTION_OPEN_TAG.exec(node.value.trim()) : null
    if (!open) {
      if (node.type === "element") convertChildren(node)
      children.push(node)
      continue
    }

    const tagName = open[1]!.toLowerCase()
    const id = open[2] ?? open[3] ?? open[4]
    const mention: Element = {
      type: "element",
      tagName,
      properties: id ? { id } : {},
      children: [],
    }

    const closeIndex = open[5]
      ? -1
      : source.findIndex(
          (other, otherIndex) => otherIndex > index && closingTagName(other) === tagName,
        )
    if (closeIndex !== -1) {
      mention.children = source.slice(index + 1, closeIndex)
      convertChildren(mention)
      index = closeIndex
    }
    children.push(mention)
  }

  parent.children = children
}

/**
 * Turns the `<mention-entry id="…">` and `<mention-feed id="…">` tags of a reply into elements.
 * Any other HTML stays raw, which react-markdown shows as text: replies follow feed content, so
 * their markup must never reach the page.
 */
export const rehypeMentionTags = () => convertChildren
