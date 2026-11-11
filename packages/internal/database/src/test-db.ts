/// <reference types="node" />

import { readFileSync } from "node:fs"
import type { SQLInputValue } from "node:sqlite"
import { DatabaseSync } from "node:sqlite"

import type { Connection } from "./connection"
import { createConnection } from "./connection"
import type { MigrationConfig } from "./migrator"
import { migrate, migrationKey } from "./migrator"

const SQLITE_BUSY = 5

/** A connection to an SQLite database in memory, or in the file at `path`, not migrated */
export const openTestDB = (path = ":memory:"): Connection => {
  // Off as in the apps, which never turn them on
  const sqlite = new DatabaseSync(path, { enableForeignKeyConstraints: false })
  return createConnection({
    execute: async (sql, params) => {
      const statement = sqlite.prepare(sql)
      statement.setReturnArrays(true)
      return statement.all(...(params as SQLInputValue[])) as unknown[] as unknown[][]
    },
    isBusy: (error) => (error as { errcode?: number }).errcode === SQLITE_BUSY,
    close: () => sqlite.close(),
  })
}

/** The migrations the apps bundle with `drizzle/migrations.js` */
const readMigrations = (): MigrationConfig => {
  // Not `new URL(..., import.meta.url)`: Vite rewrites that under a DOM test environment
  const read = (path: string) => readFileSync(`${import.meta.dirname}/drizzle/${path}`, "utf8")
  const journal: MigrationConfig["journal"] = JSON.parse(read("meta/_journal.json"))
  return {
    journal,
    migrations: Object.fromEntries(
      journal.entries.map(({ idx, tag }) => [migrationKey(idx), read(`${tag}.sql`)]),
    ),
  }
}

/**
 * An in-memory SQLite migrated as the apps migrate theirs, standing in for the platform database.
 * Mock the module with it, importing it in the factory: `vi.mock("@follow/database/db", async () =>
 * (await import("@follow/database/test-db")).createTestDB())`.
 */
export const createTestDB = async () => {
  const connection = openTestDB()
  await migrate(connection, readMigrations())
  return connection
}
