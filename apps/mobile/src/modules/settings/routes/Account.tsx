import { useTranslation } from "react-i18next"

import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import {
  GroupedInsetListCard,
  GroupedInsetListSectionHeader,
  GroupedPlainButtonCell,
} from "@/src/components/ui/grouped/GroupedList"
import { useNavigation } from "@/src/lib/navigation/hooks"

import { ChangePassword } from "./ChangePassword"

export const AccountScreen = () => {
  const { t } = useTranslation("settings")
  const navigation = useNavigation()
  return (
    <SafeNavigationScrollView
      className="bg-system-grouped-background"
      Header={<NavigationBlurEffectHeaderView title={t("titles.account")} />}
    >
      <GroupedInsetListSectionHeader label={t("profile.security")} />
      <GroupedInsetListCard>
        <GroupedPlainButtonCell
          textClassName="text-left"
          label={t("profile.change_password.label")}
          onPress={() => navigation.pushControllerView(ChangePassword)}
        />
      </GroupedInsetListCard>
    </SafeNavigationScrollView>
  )
}
