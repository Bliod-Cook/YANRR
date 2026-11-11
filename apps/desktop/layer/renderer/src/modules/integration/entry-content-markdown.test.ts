import { beforeAll, describe, expect, it } from "vitest"

import { convertHtmlToIntegrationMarkdown } from "./entry-content-markdown"

describe("convertHtmlToIntegrationMarkdown", () => {
  // The first conversion loads the markdown libraries, which can exceed a test's 5 s on a busy machine
  beforeAll(async () => {
    await convertHtmlToIntegrationMarkdown("<p>warm-up</p>")
  }, 60_000)

  it("serializes strikethrough instead of falling back to the raw HTML", async () => {
    await expect(
      convertHtmlToIntegrationMarkdown(
        "<p>Price: <del>$10</del> <s>$8</s> <strike>$6</strike> $5</p>",
      ),
    ).resolves.toBe("Price: ~~$10~~ ~~$8~~ ~~$6~~ $5\n")
  })
})
