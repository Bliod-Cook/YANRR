import { useHasNotificationActions } from "@follow/store/action/hooks"
import { ROUTE_FEED_IN_INBOX } from "@follow/store/constants/app"
import { useWhoami } from "@follow/store/user/hooks"
import { getApp, getApps } from "@react-native-firebase/app"
import type { RemoteMessage } from "@react-native-firebase/messaging"
import {
  getAPNSToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
} from "@react-native-firebase/messaging"
import { useMutation } from "@tanstack/react-query"
import { useEffect } from "react"
import { Platform } from "react-native"

import {
  registerMessagingToken,
  shouldRetryMessagingTokenRegistration,
} from "@/src/lib/messaging-registration"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { hasNotificationPermission } from "@/src/lib/permission"
import { registerPushToken } from "@/src/lib/push-token"
import { EntryDetailScreen } from "@/src/screens/(stack)/entries/[entryId]/EntryDetailScreen"

// Push needs the Firebase project of the deployment, which the build may not provide
const hasFirebase = () => getApps().length > 0

export function useUpdateMessagingToken() {
  const whoami = useWhoami()
  const hasNotificationActions = useHasNotificationActions()
  const { mutate } = useMutation({
    scope: { id: "mobile-push-token-registration" },
    mutationFn: async ({ userId, token }: { userId: string; token?: string }) => {
      if (token) {
        await registerPushToken(userId, token)
        return token
      }

      const messaging = getMessaging(getApp())
      return registerMessagingToken({
        platform: Platform.OS,
        // Starting the app never asks for the permission: that is left to the user
        requestPermission: hasNotificationPermission,
        registerDeviceForRemoteMessages: () => registerDeviceForRemoteMessages(messaging),
        getAPNSToken: () => getAPNSToken(messaging),
        getToken: () => getToken(messaging),
        saveToken: (token) => registerPushToken(userId, token),
      })
    },
    retry: shouldRetryMessagingTokenRegistration,
    retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 4_000),
    onError: (error) => {
      console.error("Failed to register push notifications", error)
    },
  })

  useEffect(() => {
    const userId = whoami?.id
    if (!userId || !hasNotificationActions || !hasFirebase()) return

    const messaging = getMessaging(getApp())
    const unsubscribe = onTokenRefresh(messaging, (token) => {
      mutate({ userId, token })
    })

    mutate({ userId })
    return unsubscribe
  }, [hasNotificationActions, mutate, whoami?.id])
}

export function useMessaging() {
  const navigation = useNavigation()
  useEffect(() => {
    if (!hasFirebase()) return

    function navigateToEntry(message: RemoteMessage) {
      if (
        !message.data ||
        message.data.type !== "new-entry" ||
        typeof message.data.view !== "string" ||
        typeof message.data.entryId !== "string"
      ) {
        return
      }

      navigation.pushControllerView(EntryDetailScreen, {
        entryId: message.data.entryId,
        view: Number.parseInt(message.data.view),
        isInbox: String(message.data.feedId).startsWith(ROUTE_FEED_IN_INBOX),
      })
    }

    const app = getApp()
    async function init() {
      const message = await getInitialNotification(getMessaging(app))
      if (message) {
        navigateToEntry(message)
      }
    }

    init()

    const unsubscribe = onNotificationOpenedApp(getMessaging(app), (remoteMessage) => {
      navigateToEntry(remoteMessage)
    })

    return () => {
      unsubscribe()
    }
  }, [navigation])
}
