import { parseIncompleteMarkdown } from "./parse-incomplete-markdown"

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/

/**
 * Splits markdown into the top-level blocks between blank lines, so a streamed reply only parses
 * and renders its last block again. Code fences and lines indented after a blank line stay in
 * their block.
 */
export const splitMarkdownBlocks = (text: string): string[] => {
  const blocks: string[] = []
  let block: string[] = []
  let fence: string | null = null
  let afterBlankLine = false

  for (const line of text.split("\n")) {
    if (fence) {
      const closing = CLOSING_FENCE.exec(line)?.[1]
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null
      block.push(line)
      continue
    }

    if (!line.trim()) {
      afterBlankLine = block.length > 0
      block.push(line)
      continue
    }

    if (afterBlankLine && !/^\s/.test(line)) {
      blocks.push(block.join("\n"))
      block = []
    }
    afterBlankLine = false
    fence = FENCE.exec(line)?.[1] ?? null
    block.push(line)
  }

  if (block.some((line) => line.trim())) blocks.push(block.join("\n"))
  return blocks
}

/** The blocks of a message; while it streams, the unfinished syntax of its last block is closed */
export const toMarkdownBlocks = (text: string, isStreaming: boolean): string[] => {
  const blocks = splitMarkdownBlocks(text)
  const last = blocks.at(-1)
  if (isStreaming && last) blocks[blocks.length - 1] = parseIncompleteMarkdown(last)
  return blocks
}
