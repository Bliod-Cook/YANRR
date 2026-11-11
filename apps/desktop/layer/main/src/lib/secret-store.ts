import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"

/** What the store needs of Electron's `safeStorage` */
export interface Encryption {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

/**
 * Secrets of the app's page, such as the tokens of its integrations: encrypted with the system's
 * key store, in one file. Where the system has no key store they are kept in memory until the
 * app quits, never written in plain text.
 */
export class SecretStore {
  private readonly session = new Map<string, string>()

  constructor(
    private readonly filePath: string,
    private readonly encryption: Encryption,
  ) {}

  /** Whether the secrets outlive this launch */
  get persistent() {
    return this.encryption.isEncryptionAvailable()
  }

  get(key: string): string | null {
    if (!this.persistent) return this.session.get(key) ?? null

    const encrypted = this.read()[key]
    return encrypted === undefined
      ? null
      : this.encryption.decryptString(Buffer.from(encrypted, "base64"))
  }

  set(key: string, value: string) {
    if (!this.persistent) {
      this.session.set(key, value)
      return
    }
    this.write({ ...this.read(), [key]: this.encryption.encryptString(value).toString("base64") })
  }

  delete(key: string) {
    this.session.delete(key)
    const { [key]: removed, ...others } = this.read()
    if (removed !== undefined) this.write(others)
  }

  keys(): string[] {
    return this.persistent ? Object.keys(this.read()) : [...this.session.keys()]
  }

  clear() {
    this.session.clear()
    rmSync(this.filePath, { force: true })
  }

  // Synchronous, so that the writes of one burst of calls land in the order they were made
  private read(): Record<string, string> {
    return existsSync(this.filePath) ? JSON.parse(readFileSync(this.filePath, "utf8")) : {}
  }

  private write(secrets: Record<string, string>) {
    writeFileSync(this.filePath, JSON.stringify(secrets))
  }
}
