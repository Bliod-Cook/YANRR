// @ts-expect-error
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs"
// @ts-expect-error
import { IDBMirrorVFS as MyVFS } from "wa-sqlite/src/examples/IDBMirrorVFS.js"
// @ts-expect-error
import * as SQLite from "wa-sqlite/src/sqlite-api.js"

import type { Connection } from "./connection"
import { createConnection } from "./connection"
import { EXPORTED_DB_FILE_NAME, SQLITE_DB_NAME } from "./constant"
import { DatabaseSource } from "./DatabaseSource"
import migrations from "./drizzle/migrations"
import { migrate } from "./migrator"
import type { DB } from "./types"

const IDB_NAME = "WA_SQLITE"

let connection: Connection | undefined
let db: DB

export async function initializeDB() {
  const module = await SQLiteESMFactory()
  const sqlite3 = SQLite.Factory(module)
  const vfs = await MyVFS.create(IDB_NAME, module)
  sqlite3.vfs_register(vfs, true)
  const handle = await sqlite3.open_v2(SQLITE_DB_NAME)

  connection = createConnection({
    execute: async (sql, params) => {
      const rows: unknown[][] = []
      for await (const stmt of sqlite3.statements(handle, sql)) {
        if (params.length > 0) {
          sqlite3.bind_collection(stmt, params)
        }
        while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
          rows.push(sqlite3.row(stmt))
        }
      }
      return rows
    },
    // Another tab writes, or has written since this connection last read
    isBusy: (error) => (error as { code?: number }).code === SQLite.SQLITE_BUSY,
    close: async () => {
      await sqlite3.close(handle)
      vfs.close()
    },
  })
  db = connection.db
}
export { db }

export const withTransaction: Connection["withTransaction"] = (fn) =>
  connection!.withTransaction(fn)

export async function migrateDB() {
  await migrate(connection!, migrations)
}

export async function getDBFile() {
  const module = await SQLiteESMFactory()
  const vfs = await MyVFS.create(IDB_NAME, module)
  const source = new DatabaseSource(vfs, SQLITE_DB_NAME)
  source.isDone.finally(() => {
    vfs.close()
  })
  const response = new Response(new ReadableStream(source), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${EXPORTED_DB_FILE_NAME}"`,
    },
  })
  const databaseFile = await response.blob()
  return databaseFile
}

export async function exportDB() {
  const databaseFile = await getDBFile()
  const fileUrl = URL.createObjectURL(databaseFile)

  const a = document.createElement("a")
  a.href = fileUrl
  a.download = EXPORTED_DB_FILE_NAME
  a.click()
  a.remove()

  URL.revokeObjectURL(fileUrl)
}

export async function deleteDB() {
  // Not opened when opening it failed
  await connection?.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(IDB_NAME)
    request.onsuccess = () => resolve()
    // Another tab has it open: it's deleted once that tab closes it, before anyone opens it again
    request.onblocked = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
