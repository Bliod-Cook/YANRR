import { mkdtempSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

import path from "pathe"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { answerFileRequest } from "./app-files"

// Node's file system stands in for Chromium's file loader, which fails for a missing file too
vi.mock("electron", () => ({
  net: { fetch: async (url: string) => new Response(await readFile(fileURLToPath(url))) },
}))

const dir = mkdtempSync(path.join(tmpdir(), "yanrr-app-files-"))
const root = path.join(dir, "renderer")
const secret = path.join(dir, "secret.txt")

describe("answerFileRequest", () => {
  beforeAll(async () => {
    await mkdir(path.join(root, "assets"), { recursive: true })
    await writeFile(path.join(root, "index.html"), "<!doctype html>")
    await writeFile(path.join(root, "assets", "main.js"), "export {}")
    await writeFile(path.join(root, "assets", "a b.js"), "spaced")
    await writeFile(secret, "secret")
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const answer = (url: string) => answerFileRequest(new Request(url), root)

  it.each([
    ["app://yanrr/index.html", "<!doctype html>"],
    ["app://yanrr/assets/main.js", "export {}"],
    ["app://yanrr/assets/a%20b.js", "spaced"],
  ])("serves %s from the renderer's directory", async (url, content) => {
    const response = await answer(url)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(content)
  })

  it.each([
    ["another host", "app://example.com/index.html"],
    ["an encoded slash", "app://yanrr/..%2Fsecret.txt"],
    ["an encoded backslash", "app://yanrr/assets/..%5C..%5Csecret.txt"],
    // The way the page used to be addressed, with the drive on Windows
    ["an absolute path", `app://yanrr${pathToFileURL(secret).pathname}`],
    ["a UNC path", "app://yanrr//server/share/secret.txt"],
    ["an encoded UNC path", "app://yanrr/%5C%5Cserver%5Cshare%5Csecret.txt"],
    ["a malformed escape", "app://yanrr/%E0%A4%A"],
    ["a missing file", "app://yanrr/assets/missing.js"],
  ])("refuses %s", async (_, url) => {
    const response = await answer(url)

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain("secret")
  })
})
