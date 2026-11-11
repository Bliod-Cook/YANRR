import { dialog, shell } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { openExternalSafely } from "./open-external"

vi.mock("electron", () => ({
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
}))
vi.mock("./i18n", () => ({ t: (key: string) => key }))
vi.mock("~/logger", () => ({ logger: { warn: vi.fn() } }))

const openExternal = vi.mocked(shell.openExternal)
const showMessageBox = vi.mocked(dialog.showMessageBox)

describe("openExternalSafely", () => {
  beforeEach(() => {
    openExternal.mockReset().mockResolvedValue()
    showMessageBox.mockReset().mockResolvedValue({ checkboxChecked: false, response: 0 })
  })

  it.each([["https://example.com/post"], ["http://example.com/?q=1"], ["mailto:me@example.com"]])(
    "opens %s without asking",
    async (url) => {
      await expect(openExternalSafely(url)).resolves.toBe(true)

      expect(showMessageBox).not.toHaveBeenCalled()
      expect(openExternal).toHaveBeenCalledWith(url)
    },
  )

  // Handing these to the system runs local files and programs or reaches file shares, as in
  // known attacks through `shell.openExternal`
  it.each([
    ["file:///etc/passwd"],
    ["FILE:///etc/passwd"],
    ["smb://attacker.example/share"],
    ["jar:http://attacker.example/x.jar!/"],
    ["res://shell32.dll/1"],
    ["ms-msdt:/id PCWDiagnostic"],
    ["search-ms:query=secret"],
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
    ["not a url"],
  ])("never opens %s, not even when asked to", async (url) => {
    await expect(openExternalSafely(url)).resolves.toBe(false)

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  // Matched by the whole scheme: a name that starts like a refused one is another app
  it.each([
    ["obsidian://new?vault=Notes"],
    ["logseq://x-callback-url/open"],
    ["MYAPP://open"],
    ["my-app+yanrr.v2://open"],
    ["file-helper://open"],
  ])("opens %s in another app once the user agrees", async (url) => {
    await expect(openExternalSafely(url)).resolves.toBe(true)

    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith(url)
  })

  it("leaves the link alone when the user declines", async () => {
    showMessageBox.mockResolvedValue({ checkboxChecked: false, response: 1 })

    await expect(openExternalSafely("obsidian://new")).resolves.toBe(false)

    expect(openExternal).not.toHaveBeenCalled()
  })

  it("reports a link no app on the system takes as not opened", async () => {
    openExternal.mockRejectedValue(new Error("No application is associated"))

    await expect(openExternalSafely("unknown-app://open")).resolves.toBe(false)
  })
})
