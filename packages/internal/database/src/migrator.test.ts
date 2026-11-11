import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import type { Connection } from "./connection"
import { migrate, migrationKey } from "./migrator"
import { openTestDB } from "./test-db"

/** Migrations as drizzle-kit bundles them, one statement between breakpoints */
const migrations = (...queries: string[]) => ({
  journal: { entries: queries.map((_, idx) => ({ idx, when: idx + 1, tag: `migration_${idx}` })) },
  migrations: Object.fromEntries(queries.map((query, idx) => [migrationKey(idx), query])),
})

const tables = async (connection: Connection) =>
  connection.db.values(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name != '__drizzle_migrations' ORDER BY name`,
  )

describe("migrate", () => {
  it("applies each migration once", async () => {
    const connection = openTestDB()

    await migrate(connection, migrations("CREATE TABLE a (id INTEGER)"))
    await migrate(
      connection,
      migrations("CREATE TABLE a (id INTEGER)", "CREATE TABLE b (id INTEGER)"),
    )

    expect(await tables(connection)).toEqual([["a"], ["b"]])
    expect(
      await connection.db.values(sql`SELECT id, created_at FROM __drizzle_migrations ORDER BY id`),
    ).toEqual([
      [1, 1],
      [2, 2],
    ])
  })

  it("stops at a failing migration, leaving nothing of it, and replays it on the next run", async () => {
    const connection = openTestDB()
    const createA = "CREATE TABLE a (id INTEGER)"
    const createC = "CREATE TABLE c (id INTEGER)"

    await expect(
      migrate(
        connection,
        migrations(
          createA,
          "CREATE TABLE b (id INTEGER);--> statement-breakpoint\nINSERT INTO missing VALUES (1);",
          createC,
        ),
      ),
    ).rejects.toHaveProperty("cause.message", "no such table: missing")
    expect(await tables(connection)).toEqual([["a"]])

    await migrate(connection, migrations(createA, "CREATE TABLE b (id INTEGER)", createC))
    expect(await tables(connection)).toEqual([["a"], ["b"], ["c"]])
  })
})
