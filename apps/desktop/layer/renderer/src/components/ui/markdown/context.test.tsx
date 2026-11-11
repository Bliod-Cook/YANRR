import { use } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"

import { MarkdownRenderActionContext } from "./context"

const transform = (url: string) => {
  const Probe = () => <i>{String(use(MarkdownRenderActionContext).transformUrl(url))}</i>
  return renderToStaticMarkup(<Probe />)
}

describe("default transformUrl", () => {
  test("keeps absolute URLs and drops relative ones, which have no entry to resolve against", () => {
    expect(transform("https://example.com/a.png")).toBe("<i>https://example.com/a.png</i>")
    expect(transform("/a.png")).toBe("<i>undefined</i>")
  })
})
