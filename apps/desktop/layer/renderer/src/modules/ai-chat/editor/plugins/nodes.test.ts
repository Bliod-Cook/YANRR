import { describe, expect, it, vi } from "vitest"

import { FileAttachmentNode, MentionNode, ShortcutNode } from "."

vi.mock("~/lib/auth", () => ({}))

describe("pasting rich text into the chat editor", () => {
  it.each([MentionNode, ShortcutNode, FileAttachmentNode])(
    "%o leaves the spans of pasted HTML to the text nodes",
    (Node) => {
      const span = document.createElement("span")
      span.style.fontWeight = "bold"
      span.textContent = "bold text"

      expect(Node.importDOM?.()?.span?.(span) ?? null).toBeNull()
    },
  )
})
