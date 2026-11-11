import { SettingIntegration } from "~/modules/settings/tabs/integration"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mgc-department-cute-re"
const priority = (1000 << 1) + 20

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.integration",
  priority,
})

export function Component() {
  return <SettingIntegration />
}
