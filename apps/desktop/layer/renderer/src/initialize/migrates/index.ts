import { getStorageNS } from "@follow/utils/ns"

import { appLog } from "~/lib/log"

import type { DefineMigrationOptions } from "./helper"
import { v2 } from "./v/v2"

const migrationVersionKey = getStorageNS("migration_version")

const getMigrationVersions = () => {
  try {
    const versions = localStorage.getItem(migrationVersionKey) || "[]"
    return new Set(JSON.parse(versions))
  } catch {
    return new Set()
  }
}
const migrations: DefineMigrationOptions[] = [v2]
export const doMigration = async () => {
  const migrationVersions = getMigrationVersions()

  for (const migration of migrations) {
    if (migrationVersions.has(migration.version)) continue

    appLog(`Migrating ${migration.version}...`)
    await migration.migrate()
    migrationVersions.add(migration.version)
  }

  localStorage.setItem(migrationVersionKey, JSON.stringify(Array.from(migrationVersions)))
}
