import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import path from "pathe"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { Encryption } from "./secret-store"
import { SecretStore } from "./secret-store"

// Stands in for `safeStorage`: reversible, and nothing of the plain text left readable
const createEncryption = (available = true): Encryption => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from(text, "utf8").reverse(),
  decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString("utf8"),
})

describe("SecretStore", () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "yanrr-secrets-"))
    filePath = path.join(dir, "secrets.json")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("keeps secrets encrypted on disk, for the next launch", () => {
    new SecretStore(filePath, createEncryption()).set("integration.readwiseToken", "token-1")

    expect(readFileSync(filePath, "utf8")).not.toContain("token-1")
    const relaunched = new SecretStore(filePath, createEncryption())
    expect(relaunched.get("integration.readwiseToken")).toBe("token-1")
    expect(relaunched.keys()).toEqual(["integration.readwiseToken"])
    expect(relaunched.persistent).toBe(true)
  })

  it("answers null for a secret it does not have, with or without a file", () => {
    const store = new SecretStore(filePath, createEncryption())
    expect(store.get("integration.cuboxToken")).toBeNull()

    store.set("integration.readwiseToken", "token-1")
    expect(store.get("integration.cuboxToken")).toBeNull()
  })

  it("forgets one secret, or all of them", () => {
    const store = new SecretStore(filePath, createEncryption())
    store.set("integration.readwiseToken", "token-1")
    store.set("integration.cuboxToken", "token-2")

    store.delete("integration.readwiseToken")
    expect(store.keys()).toEqual(["integration.cuboxToken"])

    store.clear()
    expect(store.keys()).toEqual([])
    expect(new SecretStore(filePath, createEncryption()).get("integration.cuboxToken")).toBeNull()
  })

  it("without encryption, keeps secrets for this launch only and writes nothing", () => {
    const store = new SecretStore(filePath, createEncryption(false))
    store.set("integration.readwiseToken", "token-1")

    expect(store.persistent).toBe(false)
    expect(store.get("integration.readwiseToken")).toBe("token-1")
    expect(store.keys()).toEqual(["integration.readwiseToken"])
    expect(() => readFileSync(filePath)).toThrow()
    expect(
      new SecretStore(filePath, createEncryption(false)).get("integration.readwiseToken"),
    ).toBe(null)

    store.delete("integration.readwiseToken")
    expect(store.get("integration.readwiseToken")).toBeNull()
  })
})
