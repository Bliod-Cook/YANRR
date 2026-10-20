import { describe, expect, it } from "vitest"

import createExpoConfig from "../app.config.base"

describe("Android media permissions", () => {
  const config = createExpoConfig({
    config: {},
  } as Parameters<typeof createExpoConfig>[0])

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
