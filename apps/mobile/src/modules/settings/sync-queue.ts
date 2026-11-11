import { fromAppearanceSpotlightPayload } from "@follow/shared/spotlight"
import { createSettingSyncQueue } from "@follow/store/sync/setting-sync-queue"

import { __generalSettingAtom } from "../../atoms/settings/general"
import {
  generalLocalOnlyKeys,
  SETTING_SYNC_QUEUE_STORAGE_KEY,
  uiLocalOnlyKeys,
} from "../../atoms/settings/internal/storage"
import {
  __spotlightSettingAtom,
  spotlightServerSyncWhiteListKeys,
} from "../../atoms/settings/spotlight"
import { __uiSettingAtom } from "../../atoms/settings/ui"
import { kv } from "../../lib/kv"

export const settingSyncQueue = createSettingSyncQueue({
  storage: {
    read: () => kv.getSync(SETTING_SYNC_QUEUE_STORAGE_KEY),
    write: (value) => kv.setSync(SETTING_SYNC_QUEUE_STORAGE_KEY, value),
  },
  domains: {
    general: { tab: "general", atom: __generalSettingAtom, localOnlyKeys: generalLocalOnlyKeys },
    ui: { tab: "appearance", atom: __uiSettingAtom, localOnlyKeys: uiLocalOnlyKeys },
    spotlight: {
      tab: "appearance",
      atom: __spotlightSettingAtom,
      keys: spotlightServerSyncWhiteListKeys,
      normalize: fromAppearanceSpotlightPayload,
    },
  },
})
