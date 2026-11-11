import * as SecureStore from "expo-secure-store"
import Storage from "expo-sqlite/kv-store"

import { isE2EBuild } from "./e2e-config"

// Background tasks run while the device is locked, and need the session as well
const writeOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
}

const plainTextKeyOf = (key: string) => `follow_secure_store_fallback:${key}`

/**
 * Development and E2E builds may run without access to the keychain, such as unsigned simulator
 * builds, and keep the values in plain text instead. A release build never does.
 */
let usesPlainText = false

const withKeychain = <T>(action: string, keychain: () => T, plainText: () => T): T => {
  if (usesPlainText) return plainText()
  try {
    return keychain()
  } catch (error) {
    if (!__DEV__ && !isE2EBuild()) throw error
    usesPlainText = true
    console.warn(`[secure-store] ${action} failed, keeping values in plain text from now on`, error)
    return plainText()
  }
}

// What was read or written, so the keychain is read once per key and process
const values = new Map<string, string | null>()

export const safeSecureStore = {
  /** `null` when there is no value; throws when the keychain could not be read. */
  getItem(key: string) {
    const cached = values.get(key)
    if (cached !== undefined) return cached

    const value = withKeychain(
      "getItem",
      () => SecureStore.getItem(key),
      () => Storage.getItemSync(plainTextKeyOf(key)),
    )
    values.set(key, value)
    return value
  },
  setItem(key: string, value: string) {
    withKeychain(
      "setItem",
      () => SecureStore.setItem(key, value, writeOptions),
      () => Storage.setItemSync(plainTextKeyOf(key), value),
    )
    values.set(key, value)
  },
  async removeItemAsync(key: string) {
    values.delete(key)
    Storage.removeItemSync(plainTextKeyOf(key))
    if (usesPlainText) return

    try {
      await SecureStore.deleteItemAsync(key)
    } catch (error) {
      console.warn(`[secure-store] removeItem failed for ${key}`, error)
    }
  },
}
