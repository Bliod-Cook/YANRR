import { describe, expect, it, vi } from "vitest"

import { processFile } from "./file-processing"

vi.mock("~/lib/auth", () => ({}))

// A 1×1 GIF
const GIF_BASE64 = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="

describe("processFile", () => {
  it("keeps a GIF as it is, so it stays animated", async () => {
    const bytes = Uint8Array.from(atob(GIF_BASE64), (char) => char.codePointAt(0)!)
    const gif = new File([bytes], "loop.gif", { type: "image/gif" })

    const result = await processFile(gif, { nonce: "gif-1" })

    expect(result.fileAttachment).toMatchObject({
      id: "gif-1",
      type: "image/gif",
      size: bytes.length,
      dataUrl: `data:image/gif;base64,${GIF_BASE64}`,
      previewUrl: `data:image/gif;base64,${GIF_BASE64}`,
    })
  })
})
