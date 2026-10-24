import { nativeApplicationVersion, nativeBuildVersion } from "expo-application"
import { Trans, useTranslation } from "react-i18next"
import { View } from "react-native"

import { Link } from "@/src/components/common/Link"
import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import {
  GroupedInsetListBaseCell,
  GroupedInsetListCard,
} from "@/src/components/ui/grouped/GroupedList"
import { Logo } from "@/src/components/ui/logo"
import { Text } from "@/src/components/ui/typography/Text"

export const AboutScreen = () => {
  const { t } = useTranslation("settings")
  const buildId = nativeBuildVersion
  const appVersion = nativeApplicationVersion
  const appVersionLabel = `${appVersion} (${buildId})`

  return (
    <SafeNavigationScrollView
      Header={<NavigationBlurEffectHeaderView title={t("titles.about")} />}
      className="bg-system-grouped-background"
      contentViewClassName="pt-6"
    >
      <GroupedInsetListCard>
        <GroupedInsetListBaseCell className="flex-col py-6">
          <View className="flex-1 items-center justify-center">
            <Logo height={80} width={80} />
            <Text className="mt-4 text-2xl font-semibold text-label">Yanrr</Text>
            <Text className="font-mono text-sm text-tertiary-label">{appVersionLabel}</Text>
          </View>
          <View className="mt-6 flex-1">
            <Trans
              ns="settings"
              i18nKey="about.iconLibrary"
              parent={({ children }: { children: React.ReactNode }) => (
                <Text className="text-[15px] text-label">{children}</Text>
              )}
              components={{
                IconLibraryLink: (
                  <Link className="text-accent" href="https://github.com/Richard9394/MingCute">
                    https://github.com/Richard9394/MingCute
                  </Link>
                ),
                ExternalLinkIcon: <View />,
              }}
            />

            <Trans
              ns="settings"
              i18nKey="about.licenseInfo"
              parent={({ children }: { children: React.ReactNode }) => (
                <Text className="mt-4 text-[15px] text-label">{children}</Text>
              )}
              values={{
                currentYear: new Date().getFullYear(),
                appName: "Yanrr",
              }}
            />
          </View>
        </GroupedInsetListBaseCell>
      </GroupedInsetListCard>
    </SafeNavigationScrollView>
  )
}
