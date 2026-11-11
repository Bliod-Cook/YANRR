import type { CustomIntegration, FetchTemplate } from "@follow/shared/settings/interface"
import type { EntryModel } from "@follow/store/entry/types"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { PlaceholderContext } from "./custom-integration-manager"
import { CustomIntegrationManager } from "./custom-integration-manager"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const context: PlaceholderContext = {
  title: "Title",
  url: "https://example.com/a",
  contentHtml: "",
  contentMarkdown: 'line1\n"q"',
  summary: "",
  author: "Ann",
  publishedAt: "",
  description: "",
}

const postTemplate = (headers: Record<string, string>): FetchTemplate => ({
  url: "https://example.com/hook",
  method: "POST",
  headers,
  body: '{"text":"[content_markdown]"}',
})

const ESCAPED_BODY = String.raw`{"text":"line1\n\"q\""}`

describe("CustomIntegrationManager", () => {
  it("serializes HTML line breaks without markdown hard-break backslashes", async () => {
    const context = await CustomIntegrationManager.buildPlaceholderContext({
      id: "entry-id",
      title: "MegaHouse G.E. Figure",
      url: "https://example.com/detail",
      content:
        'MegaHouse G.E. figure<br>¥990<br><img src="https://example.com/image.png"><br><a target="_blank">APP 内打开</a>',
      description: "",
      author: null,
      publishedAt: new Date("2026-04-30T03:08:59.874Z"),
    } as EntryModel)

    expect(context.contentMarkdown).toBe(`MegaHouse G.E. figure
¥990
![](https://example.com/image.png)
[APP 内打开]()
`)
  })

  describe("replacePlaceholders", () => {
    it("keeps replacement patterns in article text literal", () => {
      const result = CustomIntegrationManager.replacePlaceholders("a [title] b", {
        ...context,
        title: "$$x$$ $& $` $'",
      })
      expect(result).toBe("a $$x$$ $& $` $' b")
    })

    it("does not replace placeholders that appear inside inserted values", () => {
      const result = CustomIntegrationManager.replacePlaceholders("[title]|[summary]", {
        ...context,
        title: "see [summary] by [author]",
        summary: "S",
      })
      expect(result).toBe("see [summary] by [author]|S")
    })
  })

  describe("processFetchTemplate", () => {
    it("escapes the body for a JSON content type with parameters", async () => {
      const result = await CustomIntegrationManager.processFetchTemplate(
        postTemplate({ "Content-Type": "application/json; charset=utf-8" }),
        context,
      )
      expect(result.body).toBe(ESCAPED_BODY)
    })

    it("escapes the body when the content type is left to the default JSON header", async () => {
      const result = await CustomIntegrationManager.processFetchTemplate(postTemplate({}), context)
      expect(result.headers["content-type"]).toBe("application/json")
      expect(result.body).toBe(ESCAPED_BODY)
    })

    it("leaves the body raw for other content types", async () => {
      const result = await CustomIntegrationManager.processFetchTemplate(
        postTemplate({ "Content-Type": "text/plain" }),
        context,
      )
      expect(result.body).toBe('{"text":"line1\n"q""}')
    })
  })

  describe("executeWithToast", () => {
    const integration = {
      id: "i",
      name: "Notes",
      enabled: true,
      type: "url-scheme",
      urlSchemeTemplate: { scheme: "notes://add?title=[title]" },
    } as CustomIntegration
    const entry = { id: "e", title: "T", content: "" } as EntryModel

    afterEach(() => {
      vi.restoreAllMocks()
      vi.mocked(toast.success).mockClear()
      vi.mocked(toast.error).mockClear()
    })

    it("reports a blocked URL scheme once, as a failure", async () => {
      vi.spyOn(window, "open").mockReturnValue(null)
      await CustomIntegrationManager.executeWithToast(integration, entry)
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(toast.success).not.toHaveBeenCalled()
    })

    it("reports an opened URL scheme once, as a success", async () => {
      vi.spyOn(window, "open").mockReturnValue({} as Window)
      await CustomIntegrationManager.executeWithToast(integration, entry)
      expect(toast.success).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
