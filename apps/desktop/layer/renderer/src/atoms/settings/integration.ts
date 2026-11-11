import { createSettingAtom } from "@follow/atoms/helper/setting.js"
import { defaultIntegrationSettings } from "@follow/shared/settings/defaults"

// Kept on this device only. In the desktop app the tokens and passwords are not here but in the
// main process, see `~/modules/integration/secrets`.
export const {
  useSettingKey: useIntegrationSettingKey,
  setSetting: setIntegrationSetting,
  initializeDefaultSettings: initializeDefaultIntegrationSettings,
  getSettings: getIntegrationSettings,
  useSettingValue: useIntegrationSettingValue,
} = createSettingAtom("integration", () => ({ ...defaultIntegrationSettings }))
