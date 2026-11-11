import { SettingGeneral } from "~/modules/settings/tabs/general"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mgc-settings-7-cute-re"
const priority = 1000 << 1

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.general",
  priority,
})

export function Component() {
  return <SettingGeneral />
}
