import type { SQLiteBindValue } from "expo-sqlite"
import * as SQLite from "expo-sqlite"

import { createConnection } from "./connection"
import { SQLITE_DB_NAME } from "./constant"
import migrations from "./drizzle/migrations"
import { migrate } from "./migrator"

export const sqlite = SQLite.openDatabaseSync(SQLITE_DB_NAME)

const connection = createConnection({
  execute: async (sql, params) => {
    const statement = sqlite.prepareSync(sql)
    try {
      return statement.executeForRawResultSync(params as SQLiteBindValue[]).getAllSync()
    } finally {
      statement.finalizeSync()
    }
  },
  close: () => sqlite.closeSync(),
})

export const { db, withTransaction } = connection

// Opened on import
export async function initializeDB() {}

export async function migrateDB() {
  await migrate(connection, migrations)
}

export async function getDBFile() {}
export async function exportDB() {}
export async function deleteDB() {
  await connection.close()
  SQLite.deleteDatabaseSync(SQLITE_DB_NAME)
}
