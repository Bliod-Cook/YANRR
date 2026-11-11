import { describe, expect, it, vi } from "vitest"

import { readNdjsonStream } from "./stream"

describe("readNdjsonStream", () => {
  it("skips a line that is no JSON", async () => {
    const lines: unknown[] = []
    vi.spyOn(console, "error").mockImplementation(() => {})

    await readNdjsonStream(new Response('{"id":1}\nnot json\n{"id":2}\n'), (line) => {
      lines.push(line)
    })

    expect(lines).toEqual([{ id: 1 }, { id: 2 }])
  })

  it("fails when a line cannot be handled", async () => {
    const error = new Error("disk full")

    await expect(
      readNdjsonStream(new Response('{"id":1}\n'), () => {
        throw error
      }),
    ).rejects.toBe(error)
  })
})
