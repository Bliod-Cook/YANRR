import { fromAppearanceSpotlightPayload } from "@follow/shared/spotlight"
import { createSettingSyncQueue } from "@follow/store/sync/setting-sync-queue"
import { getStorageNS } from "@follow/utils/ns"

import { __aiSettingAtom, aiLocalOnlyKeys } from "~/atoms/settings/ai"
import { __generalSettingAtom, generalLocalOnlyKeys } from "~/atoms/settings/general"
import {
  __spotlightSettingAtom,
  spotlightServerSyncWhiteListKeys,
} from "~/atoms/settings/spotlight"
import { __uiSettingAtom, uiLocalOnlyKeys } from "~/atoms/settings/ui"

const storageKey = getStorageNS("setting_sync_queue")

export const settingSyncQueue = createSettingSyncQueue({
  storage: {
    read: () => localStorage.getItem(storageKey),
    write: (value) => localStorage.setItem(storageKey, value),
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
    ai: { tab: "ai", atom: __aiSettingAtom, localOnlyKeys: aiLocalOnlyKeys },
  },
})
