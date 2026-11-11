import type { GeneralSettings } from "@follow/shared/settings/interface"

import type { UISettings } from "../ui"

/**
 * What the settings keep in the key-value store and which of them belong to the device. Only
 * types are imported here: the local data reset reads this before anything else may load.
 */

export const getSettingStorageKey = (settingKey: string) => `follow-rn-${settingKey}`

export const SETTING_SYNC_QUEUE_STORAGE_KEY = "setting_sync_queue"

/** Device-local general settings: every other general setting syncs to the account. */
export const generalLocalOnlyKeys: (keyof GeneralSettings)[] = ["language", "appLaunchOnStartup"]

/** Device-local appearance settings: every other appearance setting syncs to the account. */
export const uiLocalOnlyKeys: (keyof UISettings)[] = [
  "uiFontFamily",
  "readerFontFamily",
  "opaqueSidebar",
  "fontScale",
  "useSystemFontScaling",
  // Works with the notification permission of this device only
  "showUnreadCountBadgeMobile",
]
