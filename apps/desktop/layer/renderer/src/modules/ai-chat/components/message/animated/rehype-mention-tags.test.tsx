import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import { describe, expect, it, vi } from "vitest"

import { MarkdownAnimateText } from "./AnimatedMarkdown"
import { rehypeMentionTags } from "./rehype-mention-tags"

vi.mock("~/lib/auth", () => ({}))

const renderReply = (content: string) => {
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(<MarkdownAnimateText content={content} />)
  return container
}

const Mention = ({ id, children }: { id?: string; children?: ReactNode }) => (
  <b data-id={id}>{children}</b>
)
const renderMentions = (content: string) => {
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(
    <ReactMarkdown
      rehypePlugins={[rehypeMentionTags]}
      components={{ "mention-entry": Mention, "mention-feed": Mention } as never}
    >
      {content}
    </ReactMarkdown>,
  )
  return container
}

describe("AI reply markdown", () => {
  it("shows HTML in a reply as text instead of running it", () => {
    const hostile = [
      `<iframe srcdoc="<script>parent.alert(1)</script>"></iframe>`,
      `Look <img src="x" onerror="alert(1)"> here`,
      `<script>alert(1)</script>`,
    ].join("\n\n")

    const reply = renderReply(hostile)

    expect(reply.querySelector("iframe, img, script")).toBeNull()
    expect(reply.textContent).toContain(`<img src="x" onerror="alert(1)">`)
  })

  it("turns the mention tags of a reply into mentions", () => {
    const reply = renderMentions(
      `See <mention-entry id="e1"></mention-entry> and <mention-feed id='f1'/> or <mention-entry>e2</mention-entry>.`,
    )

    expect([...reply.querySelectorAll("b")].map((mention) => mention.dataset.id ?? "")).toEqual([
      "e1",
      "f1",
      "",
    ])
    expect(reply.querySelectorAll("b")[2]?.textContent).toBe("e2")
    expect(reply.textContent).not.toContain("mention-")
  })

  it("keeps attributes other than the id out of a mention", () => {
    const reply = renderMentions(`<mention-entry id="e1" onclick="alert(1)"></mention-entry>`)

    expect(reply.querySelector("b")).toBeNull()
    expect(reply.textContent).toContain(`onclick="alert(1)"`)
  })
})
