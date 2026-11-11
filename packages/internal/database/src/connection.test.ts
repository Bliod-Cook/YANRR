/// <reference types="node" />

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"

import { sql } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import type { Connection } from "./connection"
import { openTestDB } from "./test-db"

const createTable = (connection: Connection) =>
  connection.db.run(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`)
const storedIds = (connection: Connection) =>
  connection.db.values(sql`SELECT id FROM t ORDER BY id`)

describe("createConnection", () => {
  it("rejects a statement that fails", async () => {
    const connection = openTestDB()
    await createTable(connection)
    await connection.db.run(sql`INSERT INTO t VALUES (1)`)

    await expect(connection.db.run(sql`INSERT INTO t VALUES (1)`)).rejects.toHaveProperty(
      "cause.message",
      "UNIQUE constraint failed: t.id",
    )
  })

  it("keeps other statements out of a transaction, which a throw rolls back", async () => {
    const connection = openTestDB()
    await createTable(connection)

    let outside: Promise<unknown> | undefined
    const transaction = connection.withTransaction(async (tx) => {
      await tx.run(sql`INSERT INTO t VALUES (1)`)
      outside = connection.db.run(sql`INSERT INTO t VALUES (2)`)
      await new Promise((resolve) => setTimeout(resolve, 10))
      throw new Error("Failed in the transaction")
    })

    await expect(transaction).rejects.toThrow("Failed in the transaction")
    await outside
    expect(await storedIds(connection)).toEqual([[2]])
  })

  describe("while another connection writes", () => {
    let directory: string
    let connection: Connection
    let other: DatabaseSync

    const lockByOtherConnection = async () => {
      directory = mkdtempSync(`${tmpdir()}/yanrr-db-`)
      const path = `${directory}/test.db`
      connection = openTestDB(path)
      await createTable(connection)
      other = new DatabaseSync(path)
      other.exec("BEGIN IMMEDIATE")
    }

    afterEach(async () => {
      if (other.isTransaction) other.exec("COMMIT")
      other.close()
      await connection.close()
      rmSync(directory, { recursive: true, force: true })
    })

    it("retries a statement until the other one is done", async () => {
      await lockByOtherConnection()
      setTimeout(() => other.exec("COMMIT"), 150)

      await connection.db.run(sql`INSERT INTO t VALUES (1)`)

      expect(await storedIds(connection)).toEqual([[1]])
    })

    it("gives up retrying after a while", async () => {
      await lockByOtherConnection()

      await expect(connection.db.run(sql`INSERT INTO t VALUES (1)`)).rejects.toHaveProperty(
        "cause.message",
        "database is locked",
      )
    })
  })
})
