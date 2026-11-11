import type { Connection } from "./connection"
import type { DB } from "./types"

export declare const sqlite: unknown
export declare const db: DB
export declare function initializeDB(): Promise<void>
/** Throws when a migration fails, leaving the database as it was before that migration */
export declare function migrateDB(): Promise<void>
export declare function getDBFile(): Promise<Blob>
export declare function exportDB(): Promise<void>
/**
 * Runs `fn` in a transaction, committed when it resolves and rolled back when it throws. Its
 * statements must go through `tx`: `db`, and the services using it, wait until it ends. Unlike
 * `db.transaction`, it lets no other statement run in the middle.
 */
export declare const withTransaction: Connection["withTransaction"]
/**
 * Closes and deletes the database, normally you should reload the app after calling this function.
 */
export declare function deleteDB(): Promise<void>
