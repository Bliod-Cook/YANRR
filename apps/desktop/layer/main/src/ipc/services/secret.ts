import { app, safeStorage } from "electron"
import { IpcMethod, IpcService } from "electron-ipc-decorator"
import path from "pathe"

import type { Encryption } from "~/lib/secret-store"
import { SecretStore } from "~/lib/secret-store"

const encryption: Encryption = {
  // Linux without a keyring "encrypts" with a key built into Chromium: plain text in effect
  isEncryptionAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"),
  encryptString: (plainText) => safeStorage.encryptString(plainText),
  decryptString: (encrypted) => safeStorage.decryptString(encrypted),
}

let store: SecretStore | undefined
// Created on first use: the profile folder is chosen at start-up
const getStore = () =>
  (store ??= new SecretStore(path.join(app.getPath("userData"), "secrets.json"), encryption))

/** Removes every secret, as signing out or clearing all data does */
export const clearSecrets = () => getStore().clear()

/** Tokens and passwords of the page's integrations, which its own storage would keep in plain text */
export class SecretService extends IpcService {
  static override readonly groupName = "secret"

  @IpcMethod()
  get(key: string): string | null {
    return getStore().get(key)
  }

  @IpcMethod()
  set(key: string, value: string): void {
    getStore().set(key, value)
  }

  @IpcMethod()
  delete(key: string): void {
    getStore().delete(key)
  }

  @IpcMethod()
  keys(): string[] {
    return getStore().keys()
  }

  @IpcMethod()
  clear(): void {
    clearSecrets()
  }

  /** Whether the secrets outlive this launch: false where the system has no key store */
  @IpcMethod()
  isPersistent(): boolean {
    return getStore().persistent
  }
}
