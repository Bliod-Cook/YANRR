import { describe, expect, it } from "vitest"

import { splitMarkdownBlocks, toMarkdownBlocks } from "./markdown-blocks"

describe("splitMarkdownBlocks", () => {
  it("splits at blank lines, but not inside a code fence or before an indented line", () => {
    const markdown = [
      "# Title",
      "",
      "- item",
      "",
      "  more of the item",
      "",
      "```js",
      "const a = 1",
      "",
      "const b = 2",
      "```",
      "",
      "Last",
    ].join("\n")

    expect(splitMarkdownBlocks(markdown)).toEqual([
      "# Title\n",
      "- item\n\n  more of the item\n",
      "```js\nconst a = 1\n\nconst b = 2\n```\n",
      "Last",
    ])
  })

  it("keeps an unclosed code fence in the last block", () => {
    expect(splitMarkdownBlocks("Intro\n\n~~~\ncode\n\nstill code")).toEqual([
      "Intro\n",
      "~~~\ncode\n\nstill code",
    ])
  })
})

describe("toMarkdownBlocks", () => {
  it("closes the unfinished syntax of a streaming message", () => {
    expect(toMarkdownBlocks("Done\n\nThis is **bold", true)).toEqual(["Done\n", "This is **bold**"])
  })

  it("leaves a finished message as it was written", () => {
    expect(toMarkdownBlocks("The interval [0, 1) is half-open", false)).toEqual([
      "The interval [0, 1) is half-open",
    ])
    expect(toMarkdownBlocks("It costs $$ 5", false)).toEqual(["It costs $$ 5"])
  })
})
