import { SyncTransactionService } from "@follow/database/services/sync-transaction"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test, vi } from "vitest"

import { LocalDatabaseErrorScreen } from "./LocalDatabaseErrorScreen"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

// Without translations every text shows as its key
const unsentChangesWarning = "local_database_error.unsent_changes"

const renderScreen = async () => {
  const element = document.createElement("div")
  const root = createRoot(element)
  await act(async () => {
    root.render(<LocalDatabaseErrorScreen error={new Error("A migration failed")} />)
  })
  const text = element.textContent
  await act(async () => {
    root.unmount()
  })
  return text
}

describe("LocalDatabaseErrorScreen", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  test("warns before a reset deletes changes made offline", async () => {
    expect(await renderScreen()).not.toContain(unsentChangesWarning)

    await SyncTransactionService.insert({
      id: "star",
      kind: "collection.add",
      payload: { entryId: "entry" },
      createdAt: new Date(),
    })

    const text = await renderScreen()
    expect(text).toContain(unsentChangesWarning)
    expect(text).toContain("A migration failed")
  })
})
