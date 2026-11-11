import fsp from "node:fs/promises"
import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"

import { dialog, shell } from "electron"
import path from "pathe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { IntegrationService } from "./integration"

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  // Node's network stack stands in for Chromium's, which takes the same request
  net: { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
  shell: {
    openExternal: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
}))

vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))

const storeData = vi.hoisted(() => new Map<string, unknown>())

vi.mock("~/lib/store", () => ({
  store: {
    get: (key: string) => storeData.get(key),
    set: (key: string, value: unknown) => storeData.set(key, value),
  },
}))

vi.mock("~/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

describe("IntegrationService", () => {
  let vaultPath: string | undefined

  afterEach(async () => {
    if (!vaultPath) return

    await fsp.rm(vaultPath, { force: true, recursive: true })
    vaultPath = undefined
  })

  it("saves Obsidian titles with path separators as one markdown file", async () => {
    vaultPath = await fsp.mkdtemp(path.join(os.tmpdir(), "yanrr-obsidian-"))
    const service = new IntegrationService()

    await expect(
      service.saveToObsidian({
        url: "https://example.com",
        title: "KAWA DESIGN 少女前线2：追放 索米·雪兔献礼 1/6比例手办",
        content: "content",
        author: "Yanrr",
        publishedAt: "2026-05-14T04:20:44.405Z",
        vaultPath,
      }),
    ).resolves.toEqual({ success: true })

    await expect(fsp.readdir(vaultPath)).resolves.toEqual([
      "KAWA DESIGN 少女前线2：追放 索米·雪兔献礼 1_6比例手办.md",
    ])
    await expect(
      fsp.stat(path.join(vaultPath, "KAWA DESIGN 少女前线2：追放 索米·雪兔献礼 1")),
    ).rejects.toThrow()
  })

  describe("qBittorrent", () => {
    // Two qBittorrent Web UIs, each with a session id of its own
    const servers: Server[] = []
    const received: { host: string; path?: string; cookie?: string }[] = []

    const startQBittorrent = async (sid: string) => {
      const server = createServer((request, response) => {
        const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        received.push({ host, path: request.url, cookie: request.headers.cookie })
        if (request.url === "/api/v2/auth/login") {
          response.setHeader("set-cookie", `SID=${sid}; HttpOnly; path=/`)
          response.end("Ok.")
          return
        }
        response.statusCode = request.headers.cookie === `SID=${sid}` ? 200 : 403
        response.end()
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      servers.push(server)
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    }

    beforeEach(() => {
      storeData.clear()
      received.length = 0
    })

    afterEach(async () => {
      for (const server of servers.splice(0)) {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    })

    it("sends a session id only to the qBittorrent it came from", async () => {
      const first = await startQBittorrent("first-sid")
      const second = await startQBittorrent("second-sid")
      const service = new IntegrationService()
      const login = { username: "admin", password: "secret" }

      await service.loginToQBittorrent({ host: first, ...login })
      await expect(service.addMagnet({ host: second, urls: ["magnet:?xt=1"] })).resolves.toMatch(
        /not logged in/i,
      )
      await service.loginToQBittorrent({ host: second, ...login })
      await service.addMagnet({ host: second, urls: ["magnet:?xt=1"] })

      expect(received.filter(({ host }) => host === second)).toEqual([
        { host: second, path: "/api/v2/auth/login", cookie: undefined },
        { host: second, path: "/api/v2/torrents/add", cookie: "SID=second-sid" },
      ])
    })
  })

  // Which links open is `openExternalSafely`'s to say; the integration has to report a link it
  // did not open as failed
  it("fails a URL scheme integration whose link was not opened", async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ checkboxChecked: false, response: 1 })
    const service = new IntegrationService()

    await expect(service.openURLScheme("logseq://open")).rejects.toThrow(/not opened/i)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
