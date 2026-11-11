import type { Element, Root, RootContent } from "hast"
import { describe, expect, it } from "vitest"

import { parseHtml } from "./html"

const elements = (tree: Root | Element, tagName: string): Element[] =>
  tree.children.flatMap((child: RootContent) =>
    child.type === "element"
      ? [...(child.tagName === tagName ? [child] : []), ...elements(child, tagName)]
      : [],
  )

describe("sanitizer", () => {
  it("drops a style element inside SVG, whose text a browser parses as markup", () => {
    const { hastTree } = parseHtml(
      "<svg><style>&lt;foreignObject&gt;&lt;img src=x onerror=alert(1)&gt;&lt;/foreignObject&gt;</style></svg>",
      { renderInlineStyle: true },
    )

    expect(elements(hastTree, "svg")).toHaveLength(1)
    expect(elements(hastTree, "style")).toEqual([])
  })

  it("keeps style blocks, inline styles and classes only when inline styles are on", () => {
    const html = '<style>p { color: red }</style><p style="color: red" class="lead">Body</p>'

    const off = parseHtml(html)
    expect(elements(off.hastTree, "style")).toEqual([])
    expect(elements(off.hastTree, "p")[0]?.properties).toEqual({})
    expect(off.toText()).toBe("Body")

    const on = parseHtml(html, { renderInlineStyle: true })
    expect(elements(on.hastTree, "style")[0]?.children).toEqual([
      expect.objectContaining({ type: "text", value: "p { color: red }" }),
    ])
    expect(elements(on.hastTree, "p")[0]?.properties).toEqual({
      style: "color: red",
      className: ["lead"],
    })
  })

  it("keeps the URLs in a style block intact", () => {
    const { hastTree } = parseHtml(
      "<style>p { background: url(https://example.com/a.png) }</style>",
      {
        renderInlineStyle: true,
      },
    )

    expect(elements(hastTree, "style")[0]?.children).toEqual([
      expect.objectContaining({ value: "p { background: url(https://example.com/a.png) }" }),
    ])
  })

  it("keeps the SVG presentation attributes it allows", () => {
    const { hastTree } = parseHtml(
      '<svg viewBox="0 0 10 10" stroke-width="2"><text font-size="3" text-anchor="middle">T</text></svg>',
    )

    expect(elements(hastTree, "svg")[0]?.properties).toEqual({
      viewBox: "0 0 10 10",
      strokeWidth: "2",
    })
    expect(elements(hastTree, "text")[0]?.properties).toEqual({
      fontSize: "3",
      textAnchor: "middle",
    })
  })

  it("lets an SVG use element reference only the document's own shapes", () => {
    const { hastTree } = parseHtml(
      '<svg><use xlink:href="#shape" x="1"/><use href="data:image/svg+xml,&lt;svg&gt;" xlink:href="https://example.com/a.svg#b"/></svg>',
    )

    expect(elements(hastTree, "use").map((use) => use.properties)).toEqual([
      { xLinkHref: "#shape", x: "1" },
      {},
    ])
  })

  it("keeps a title only as an SVG tooltip", () => {
    const { hastTree } = parseHtml("<title>Window title</title><svg><title>Chart</title></svg>")

    expect(hastTree.children).toEqual([expect.objectContaining({ tagName: "svg" })])
    expect(elements(hastTree, "title")).toHaveLength(1)
  })

  it("gives every iframe the same sandbox, whatever the content asks for", () => {
    const { hastTree } = parseHtml(
      '<iframe src="https://player.example.com/1" sandbox="allow-scripts allow-top-navigation"></iframe><iframe src="https://player.example.com/2"></iframe>',
    )

    for (const iframe of elements(hastTree, "iframe")) {
      expect(iframe.properties.sandbox).toEqual([
        "allow-scripts",
        "allow-same-origin",
        "allow-popups",
        "allow-forms",
      ])
    }
  })
})

describe("bare URLs in text", () => {
  const links = (html: string) =>
    elements(parseHtml(html).hastTree, "a").map((a) => a.properties.href)

  it("ends a link at CJK punctuation", () => {
    const { hastTree } = parseHtml("<p>详见https://example.com/a。后续内容</p>")

    expect(elements(hastTree, "p")[0]?.children).toEqual([
      expect.objectContaining({ value: "详见" }),
      expect.objectContaining({ tagName: "a", properties: { href: "https://example.com/a" } }),
      expect.objectContaining({ value: "。后续内容" }),
    ])
  })

  it("leaves trailing punctuation and an unmatched parenthesis out of a link", () => {
    expect(links("<p>(see https://example.com/a).</p>")).toEqual(["https://example.com/a"])
    expect(links("<p>Go to https://example.com/b, then https://example.com/c!</p>")).toEqual([
      "https://example.com/b",
      "https://example.com/c",
    ])
  })

  it("keeps a parenthesis that belongs to the URL", () => {
    expect(links("<p>https://en.wikipedia.org/wiki/Mercury_(planet)</p>")).toEqual([
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
    ])
  })
})

const coverImageUrl = "https://example.com/images/cover.jpg?a=1&b=2"
const baseUrl = "https://example.com/posts/article"

describe("entry cover images", () => {
  it("prepends a missing cover before the body and its other images", () => {
    const result = parseHtml('<p>Article body</p><img src="https://example.com/other.jpg">', {
      coverImageUrl,
    })

    expect(result.hastTree.children[0]).toMatchObject({
      type: "element",
      tagName: "img",
      properties: { src: coverImageUrl },
    })
    expect(result.images).toEqual([coverImageUrl, "https://example.com/other.jpg"])
    expect(result.toText()).toBe("Article body")
  })

  it.each([
    "https://example.com/images/cover.jpg?a=1&amp;b=2",
    "/images/cover.jpg?a=1&amp;b=2",
    "../images/cover.jpg?a=1&amp;b=2",
    "//example.com/images/cover.jpg?a=1&amp;b=2",
    "https://example.com/images/cover.jpg?a=1&amp;b=2#image",
  ])("does not duplicate a cover already in a nested image: %s", (src) => {
    const result = parseHtml(`<p>Before</p><figure><a href="#"><img src="${src}"></a></figure>`, {
      coverImageUrl,
      baseUrl,
    })

    expect(result.images).toEqual([coverImageUrl])
    expect(result.hastTree.children[0]).toMatchObject({ tagName: "p" })
  })

  it("does not mistake a link to the cover for a displayed image", () => {
    const result = parseHtml(`<a href="${coverImageUrl}">View cover</a>`, { coverImageUrl })

    expect(result.images).toEqual([coverImageUrl])
  })

  it("keeps distinct images selected through query parameters", () => {
    const result = parseHtml('<img src="https://example.com/images/cover.jpg?a=2&amp;b=2">', {
      coverImageUrl,
    })

    expect(result.images).toHaveLength(2)
  })

  it("respects hidden media", () => {
    const result = parseHtml('<p>Article body</p><img src="https://example.com/other.jpg">', {
      coverImageUrl,
      noMedia: true,
    })

    expect(result.images).toEqual([])
    expect(result.toText()).toBe("Article body")
  })

  it("can render a cover without body text", () => {
    expect(parseHtml("", { coverImageUrl }).images).toEqual([coverImageUrl])
  })

  it("preserves ordinary HTML when no cover is supplied", () => {
    expect(parseHtml("<p>Article body</p>").images).toEqual([])
  })

  it("sanitizes the inserted cover URL", () => {
    expect(
      parseHtml("<p>Article body</p>", { coverImageUrl: "javascript:alert(1)" }).images,
    ).toEqual([])
  })
})
