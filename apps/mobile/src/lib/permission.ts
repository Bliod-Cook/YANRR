import * as Notifications from "expo-notifications"
import { t } from "i18next"
import { Platform } from "react-native"

import { getUISettings } from "../atoms/settings/ui"
import { toast } from "./toast"

function ensureNotificationChannel() {
  if (Platform.OS !== "android") return
  void Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF231F7C",
  })
}

/** Checks the notification permission without asking for it */
export async function hasNotificationPermission() {
  ensureNotificationChannel()
  const { status } = await Notifications.getPermissionsAsync()
  return status === "granted"
}

/** Asks for the notification permission, which only the user's own action may do */
export async function requestNotificationPermission() {
  if (await hasNotificationPermission()) return true

  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== "granted") {
    toast.error(t("permission.notification_denied"))
    return false
  }
  return true
}

/**
 * Only checks the notification permission; asking for it is left to the user's own action,
 * see the badge setting.
 */
export async function setBadgeCountAsyncWithPermission(
  badgeCount: number,
  { skipSettingCheck = false }: { skipSettingCheck?: boolean } = {},
) {
  const { showUnreadCountBadgeMobile } = getUISettings()
  if (!showUnreadCountBadgeMobile && !skipSettingCheck) {
    return false
  }

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== "granted") {
    return false
  }

  const currentBadgeCount = await Notifications.getBadgeCountAsync()
  if (badgeCount === currentBadgeCount) {
    return false
  }

  return await Notifications.setBadgeCountAsync(badgeCount)
}
