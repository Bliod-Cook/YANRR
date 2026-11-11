import type { CustomIntegration } from "@follow/shared/settings/interface"
import { describe, expect, test, vi } from "vitest"

import { getIntegrationSettings } from "~/atoms/settings/integration"

import {
  moveIntegrationSecretsToMainProcess,
  readCustomIntegrationHeaders,
  readIntegrationSecret,
} from "./secrets"

// The desktop app: the preload script's bridge, answered by a main process that keeps secrets
// in memory, and the settings an older version stored in the page's storage
const mainProcess = vi.hoisted(() => {
  const secrets = new Map<string, string>()
  const calls: string[] = []
  const bridge = {
    invoke: async (channel: string, key: string, value: string) => {
      calls.push(channel)
      switch (channel) {
        case "secret.get": {
          return secrets.get(key) ?? null
        }
        case "secret.set": {
          secrets.set(key, value)
          return
        }
        case "secret.keys": {
          return [...secrets.keys()]
        }
        default: {
          throw new Error(`Unexpected ${channel}`)
        }
      }
    },
  }
  vi.stubGlobal("electron", bridge)
  Object.assign(window, { electron: bridge })

  const hook: CustomIntegration = {
    id: "hook",
    name: "Hook",
    icon: "i-mgc-send-plane-cute-re",
    type: "http",
    enabled: true,
    fetchTemplate: {
      method: "POST",
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer hook-token" },
      body: "[title]",
    },
  }
  localStorage.setItem(
    "follow:integration",
    JSON.stringify({ enableReadwise: true, readwiseToken: "rw-token", customIntegration: [hook] }),
  )

  return { calls }
})

describe("integration secrets in the desktop app", () => {
  test("move from the page's storage to the main process at start-up, once", async () => {
    await moveIntegrationSecretsToMainProcess()

    const stored = localStorage.getItem("follow:integration")!
    expect(stored).not.toContain("rw-token")
    expect(stored).not.toContain("hook-token")
    expect(JSON.parse(stored)).toMatchObject({
      enableReadwise: true,
      readwiseToken: "",
      customIntegration: [{ id: "hook", fetchTemplate: { body: "[title]", headers: {} } }],
    })
    await expect(readIntegrationSecret("readwiseToken")).resolves.toBe("rw-token")
    await expect(
      readCustomIntegrationHeaders(getIntegrationSettings().customIntegration[0]!),
    ).resolves.toEqual({ Authorization: "Bearer hook-token" })

    mainProcess.calls.length = 0
    await moveIntegrationSecretsToMainProcess()
    expect(mainProcess.calls).not.toContain("secret.set")
  })
})
