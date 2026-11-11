import { drizzle } from "drizzle-orm/sqlite-proxy"

import { ResourceLock } from "./ResourceLock"
import * as schema from "./schemas"
import type { DB } from "./types"

export interface Driver {
  /** Runs a statement and resolves to its rows, each an array of column values */
  execute: (sql: string, params: unknown[]) => Promise<unknown[][]>
  /** Whether `execute` failed because another connection, such as another tab's, holds a lock */
  isBusy?: (error: unknown) => boolean
  close: () => unknown
}

export interface Connection {
  db: DB
  /** See `withTransaction` of `db.ts` */
  withTransaction: <T>(fn: (tx: DB) => Promise<T>) => Promise<T>
  /** Closes the database once the statements in progress are done; nothing runs on it after */
  close: () => Promise<void>
}

const BUSY_RETRIES = 5
const BUSY_RETRY_DELAY_MS = 100

/** Runs the statements one at a time, and those of a transaction with no others in between */
export function createConnection({ execute, isBusy = () => false, close }: Driver): Connection {
  const lock = new ResourceLock()

  const executeRetryingWhileBusy = async (sql: string, params: unknown[]) => {
    for (let retries = 0; ; retries++) {
      try {
        return await execute(sql, params)
      } catch (error) {
        if (!isBusy(error) || retries === BUSY_RETRIES) throw error
        await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAY_MS))
      }
    }
  }

  const connect = (acquireLock: boolean) =>
    drizzle(
      async (sql, params, method) => {
        const release = acquireLock ? await lock.acquire() : undefined
        try {
          const rows = await executeRetryingWhileBusy(sql, params)
          return { rows: method === "get" ? rows[0] : rows } as { rows: unknown[] }
        } finally {
          release?.()
        }
      },
      { schema },
    )

  const db = connect(true)
  // The statements of the transaction holding the lock
  const transactionDB = connect(false)

  return {
    db,
    withTransaction: async (fn) => {
      const release = await lock.acquire()
      try {
        // Takes the write lock up front, where a busy database is retried
        return await transactionDB.transaction(fn, { behavior: "immediate" })
      } finally {
        release()
      }
    },
    close: async () => {
      await lock.acquire()
      await close()
    },
  }
}
