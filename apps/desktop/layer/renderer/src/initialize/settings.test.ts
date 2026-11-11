import { describe, expect, test, vi } from "vitest"

import { getSpotlightSettings } from "~/atoms/settings/spotlight"

import { initializeSettings } from "./settings"

// Stored by a version without the spotlights, before the setting atoms are created
vi.hoisted(() => {
  localStorage.setItem("follow:spotlight", "{}")
})

describe("initializeSettings", () => {
  test("fills in the defaults a stored setting lacks", () => {
    initializeSettings()

    expect(getSpotlightSettings().spotlights).toEqual([])
  })
})
