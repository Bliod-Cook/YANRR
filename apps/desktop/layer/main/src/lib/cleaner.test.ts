import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import path from "pathe"
import { afterEach, expect, it, vi } from "vitest"

import { SecretService } from "~/ipc/services/secret"

import { clearAllDataAndConfirm } from "./cleaner"

const mocks = vi.hoisted(() => ({
  userData: "",
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Reversible, as `safeStorage` is on a system with a key store
vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (text: string) => Buffer.from(text, "utf8").reverse(),
    decryptString: (encrypted: Buffer) => Buffer.from(encrypted).reverse().toString("utf8"),
  },
}))

vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))

vi.mock("@follow/shared/bridge", () => ({
  callWindowExpose: () => ({ endSession: async () => {}, toast: mocks.toast }),
}))
vi.mock("~/helper", () => ({ getIconPath: () => "" }))
vi.mock("~/manager/window", () => ({
  WindowManager: { getMainWindow: () => ({ reload: () => {} }) },
}))
vi.mock("./i18n", () => ({ t: (key: string) => key }))
vi.mock("./sessions", () => ({
  getSessions: () => [{ clearCache: async () => {}, clearStorageData: async () => {} }],
}))

mocks.userData = mkdtempSync(path.join(tmpdir(), "yanrr-cleaner-"))
afterEach(() => rmSync(mocks.userData, { recursive: true, force: true }))

it("removes the secrets of the integrations with all other data", async () => {
  new SecretService().set("integration.readwiseToken", "token-1")

  await clearAllDataAndConfirm()

  expect(new SecretService().keys()).toEqual([])
  expect(mocks.toast.success).toHaveBeenCalledOnce()
})
