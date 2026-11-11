import { deleteDB } from "@follow/database/db"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button, View } from "react-native"

import { Text } from "@/src/components/ui/typography/Text"

import { PlatformActivityIndicator } from "../components/ui/loading/PlatformActivityIndicator"
import { BugCuteReIcon } from "../icons/bug_cute_re"
import { useStartupState } from "../initialize/startup"
import { reloadApp } from "../lib/reload-app"

const resetLocalData = async () => {
  try {
    await deleteDB()
  } catch (error) {
    console.error(error)
  }
  await reloadApp("Reset local data")
}

/** Shows the screens only once the database is migrated and the stores are hydrated */
export const StartupProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation()
  const { ready, error } = useStartupState()
  if (error) {
    return (
      <View className="flex-1 items-center justify-center">
        <BugCuteReIcon color="#ff0000" height={48} width={48} />
        <Text className="mt-5 text-text">{t("migration.error_title")}</Text>
        <View className="mt-2 rounded-md bg-system-background p-2">
          <Text className="font-mono text-text">{error.message}</Text>
        </View>

        <Button title={t("retry", { ns: "common" })} onPress={() => reloadApp("Retry startup")} />
        <Button title={t("migration.reset_database")} onPress={resetLocalData} />
      </View>
    )
  }
  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center">
        <PlatformActivityIndicator />
        <Text className="mt-4 text-label">{t("migration.in_progress")}</Text>
      </View>
    )
  }
  return children
}
