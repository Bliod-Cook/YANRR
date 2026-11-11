import { sql } from "drizzle-orm"

import type { Connection } from "./connection"

export interface MigrationConfig {
  journal: { entries: { idx: number; when: number; tag: string }[] }
  /** The SQL of each journal entry by `migrationKey`, as `drizzle/migrations.js` bundles it */
  migrations: Record<string, string>
}

export const migrationKey = (idx: number) => `m${idx.toString().padStart(4, "0")}`

/**
 * Applies the migrations newer than the last applied one, each in a transaction. A failing one
 * throws and leaves the database as it was before it.
 */
export async function migrate(
  { db, withTransaction }: Pick<Connection, "db" | "withTransaction">,
  { journal, migrations }: MigrationConfig,
) {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `)
  const [lastApplied] = await db.values<[number]>(
    sql`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`,
  )

  for (const { idx, when, tag } of journal.entries) {
    if (lastApplied && Number(lastApplied[0]) >= when) continue
    const query = migrations[migrationKey(idx)]
    if (!query) throw new Error(`Missing migration: ${tag}`)

    await withTransaction(async (tx) => {
      for (const statement of query.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.run(sql.raw(statement))
      }
      await tx.run(
        sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES ('', ${when})`,
      )
    })
  }
}
