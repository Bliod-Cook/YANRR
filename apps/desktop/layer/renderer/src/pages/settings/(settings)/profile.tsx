import { Divider } from "@follow/components/ui/divider/Divider.js"

import { ProfileSettingForm } from "~/modules/profile/profile-setting-form"
import { UpdatePasswordForm } from "~/modules/profile/update-password-form"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mgc-user-setting-cute-re"
const priority = (1000 << 3) + 10
export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.account",
  priority,
})

export function Component() {
  return (
    <section className="mt-4">
      <ProfileSettingForm />

      <Divider className="mb-6 mt-8" />

      <UpdatePasswordForm />
    </section>
  )
}
