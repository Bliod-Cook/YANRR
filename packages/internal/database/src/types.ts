import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core/db"
import type { SqliteRemoteResult } from "drizzle-orm/sqlite-proxy"

import type * as schema from "./schemas"

/** The database, or a transaction of it */
export type DB = BaseSQLiteDatabase<"async", SqliteRemoteResult, typeof schema>
