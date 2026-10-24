import { useWhoami } from "@follow/store/user/hooks"
import { cn } from "@follow/utils"
import * as Haptics from "expo-haptics"
import type { PropsWithChildren } from "react"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Pressable, View } from "react-native"

import { setGeneralSetting, useGeneralSettingKey } from "@/src/atoms/settings/general"
import { UserAvatar } from "@/src/components/ui/avatar/UserAvatar"
import { UIBarButton } from "@/src/components/ui/button/UIBarButton"
import { CheckCircleLineIcon } from "@/src/icons/check_circle_line"
import { RoundFillIcon } from "@/src/icons/round_fill"
import { RoundLineIcon } from "@/src/icons/round_line"
import { SortAscendingLineIcon } from "@/src/icons/sort_ascending_line"
import { SortDescendingLineIcon } from "@/src/icons/sort_descending_line"
import { useSwitchTab } from "@/src/lib/navigation/bottom-tab/hooks"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { toast } from "@/src/lib/toast"
import { LoginScreen } from "@/src/screens/(modal)/LoginScreen"
import { accentColor, useColor } from "@/src/theme/colors"

import { showMarkAllAsReadDialog } from "../dialogs/MarkAllAsReadDialog"
import { useSelectedFeed, useSelectedView } from "./atoms"

export const ActionGroup = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return <View className={cn("flex flex-row items-center gap-1", className)}>{children}</View>
}

export function HomeLeftAction() {
  const { t } = useTranslation()
  const user = useWhoami()

  const navigation = useNavigation()
  const switchTab = useSwitchTab()
  const handlePress = useCallback(() => {
    if (user) {
      // The Settings tab, which shows the account
      switchTab(3)
    } else {
      navigation.presentControllerView(LoginScreen)
    }
  }, [navigation, switchTab, user])

  return (
    <ActionGroup className="ml-2">
      <Pressable
        testID="home-avatar-trigger"
        accessibilityRole="button"
        accessibilityLabel={user ? t("tabs.settings") : t("settings.sign_in_cta")}
        onPress={handlePress}
      >
        <UserAvatar
          image={user?.image}
          name={user?.name}
          className="rounded-full"
          color={accentColor}
          preview={false}
        />
      </Pressable>
    </ActionGroup>
  )
}

interface HeaderActionButtonProps {
  variant?: "primary" | "secondary"
}

export const MarkAllAsReadActionButton = ({ variant = "secondary" }: HeaderActionButtonProps) => {
  const { t } = useTranslation()
  const { size, color } = useButtonVariant({ variant })
  const selectedFeed = useSelectedFeed()
  const selectedView = useSelectedView()

  return (
    <UIBarButton
      label={t("operation.mark_all_as_read")}
      normalIcon={<CheckCircleLineIcon height={size} width={size} color={color} />}
      onPress={() => {
        showMarkAllAsReadDialog(selectedFeed, selectedView)
      }}
    />
  )
}

const useButtonVariant = ({ variant = "primary" }: HeaderActionButtonProps) => {
  const label = useColor("label")
  const size = 20
  const color = variant === "primary" ? accentColor : label
  return { size, color }
}
export const UnreadOnlyActionButton = ({ variant = "secondary" }: HeaderActionButtonProps) => {
  const { t } = useTranslation()
  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const { size, color } = useButtonVariant({ variant })
  return (
    <UIBarButton
      label={
        unreadOnly
          ? t("operation.toggle_unread_only.show_all.label")
          : t("operation.toggle_unread_only.show_unread_only.label")
      }
      normalIcon={<RoundLineIcon height={size} width={size} color={color} />}
      selectedIcon={<RoundFillIcon height={size} width={size} color={color} />}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        setGeneralSetting("unreadOnly", !unreadOnly)
        toast.success(
          unreadOnly
            ? t("operation.toggle_unread_only.show_all.success")
            : t("operation.toggle_unread_only.show_unread_only.success"),
        )
      }}
      selected={unreadOnly}
      overlay={false}
    />
  )
}

export const EntrySortOrderActionButton = ({ variant = "secondary" }: HeaderActionButtonProps) => {
  const { t } = useTranslation()
  const sortOrder = useGeneralSettingKey("timelineSortOrder")
  const { size, color } = useButtonVariant({ variant })
  const nextSortOrder = sortOrder === "desc" ? "asc" : "desc"

  return (
    <UIBarButton
      label={
        nextSortOrder === "asc"
          ? t("operation.sort_entries.oldest_unread_first.label")
          : t("operation.sort_entries.newest_first.label")
      }
      normalIcon={
        sortOrder === "asc" ? (
          <SortAscendingLineIcon height={size} width={size} color={color} />
        ) : (
          <SortDescendingLineIcon height={size} width={size} color={color} />
        )
      }
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        setGeneralSetting("timelineSortOrder", nextSortOrder)
        toast.success(
          nextSortOrder === "asc"
            ? t("operation.sort_entries.oldest_unread_first.success")
            : t("operation.sort_entries.newest_first.success"),
        )
      }}
      overlay={false}
    />
  )
}
