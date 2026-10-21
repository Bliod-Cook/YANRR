import { describe, expect, it } from "vitest"

import createExpoConfig from "../app.config.base"

const config = createExpoConfig({
  config: {},
} as Parameters<typeof createExpoConfig>[0])

describe("Android version code", () => {
  it("grows with the version, so a release installs over the one before", () => {
    const [major, minor, patch] = config.version!.split(".").map(Number)

    expect(config.android?.versionCode).toBe(major! * 10000 + minor! * 100 + patch!)
  })
})

describe("Android media permissions", () => {
  it("blocks broad media access that is not required by the app", () => {
    expect(config.android?.blockedPermissions).toEqual([
      "android.permission.ACCESS_MEDIA_LOCATION",
      "android.permission.CAMERA",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.RECORD_AUDIO",
    ])
  })

  it("configures the media library for write-only access", () => {
    expect(config.plugins).toContainEqual([
      "expo-media-library",
      {
        photosPermission: "Allow $(PRODUCT_NAME) to access your photos.",
        savePhotosPermission: "Allow $(PRODUCT_NAME) to save photos.",
        isAccessMediaLocationEnabled: false,
        granularPermissions: [],
      },
    ])
  })
})
