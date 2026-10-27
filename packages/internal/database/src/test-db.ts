/// <reference types="node" />

import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"

import * as schema from "./schemas"

/**
 * A migrated in-memory SQLite for tests, standing in for the platform database that `db` is.
 * Mock `db` with it, importing it in the factory: `vi.mock("@follow/database/db", async () =>
 * ({ db: await (await import("@follow/database/test-db")).createTestDB() }))`.
 */
export const createTestDB = async () => {
  const sqlite = new DatabaseSync(":memory:")
  const db = drizzle(
    async (sql, params, method) => {
      const statement = sqlite.prepare(sql)
      if (method === "run") {
        statement.run(...(params as never[]))
        return { rows: [] }
      }
      statement.setReturnArrays(true)
      // Arrays, not objects, since setReturnArrays
      const rows = statement.all(...(params as never[])) as unknown as unknown[][]
      return { rows: method === "get" ? rows[0] : rows } as { rows: unknown[] }
    },
    { schema },
  )
  await migrate(
    db,
    async (queries) => {
      for (const query of queries) sqlite.exec(query)
    },
    { migrationsFolder: fileURLToPath(new URL("drizzle", import.meta.url)) },
  )
  return db
}
