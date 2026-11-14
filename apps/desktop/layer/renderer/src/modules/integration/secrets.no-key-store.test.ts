import { expect, test, vi } from "vitest"

import { getIntegrationSettings } from "~/atoms/settings/integration"

import {
  moveIntegrationSecretsToMainProcess,
  readIntegrationSecret,
  writeIntegrationSecret,
} from "./secrets"

// The desktop app on a system without a key store: the main process keeps secrets in memory
// until it quits. The settings an older version stored in the page's storage hold a token.
const mainProcess = vi.hoisted(() => {
  const secrets = new Map<string, string>()
  const bridge = {
    invoke: async (channel: string, key: string, value: string) => {
      switch (channel) {
        case "secret.get": {
          return secrets.get(key) ?? null
        }
        case "secret.set": {
          secrets.set(key, value)
          return
        }
        case "secret.delete": {
          secrets.delete(key)
          return
        }
        case "secret.keys": {
          return [...secrets.keys()]
        }
        case "secret.isPersistent": {
          return false
        }
        default: {
          throw new Error(`Unexpected ${channel}`)
        }
      }
    },
  }
  vi.stubGlobal("electron", bridge)
  Object.assign(window, { electron: bridge })
  localStorage.setItem(
    "follow:integration",
    JSON.stringify({ enableReadwise: true, readwiseToken: "rw-token" }),
  )
  return { quit: () => secrets.clear() }
})

test("secrets stay in the page's storage, where they outlive the launch", async () => {
  await moveIntegrationSecretsToMainProcess()
  await expect(readIntegrationSecret("readwiseToken")).resolves.toBe("rw-token")

  mainProcess.quit()
  await moveIntegrationSecretsToMainProcess()
  await expect(readIntegrationSecret("readwiseToken")).resolves.toBe("rw-token")

  // A token the user changed is not brought back by the one stored before
  await writeIntegrationSecret("readwiseToken", "rw-token-2")
  expect(getIntegrationSettings().readwiseToken).toBe("")
})
