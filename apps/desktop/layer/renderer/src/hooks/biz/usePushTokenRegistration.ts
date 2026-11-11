import { useWhoami } from "@follow/store/user/hooks"
import { useEffect } from "react"

import { useApiUnreachable } from "~/atoms/api-connection"
import { useServerCapability } from "~/atoms/server-configs"
import { registerPushToken } from "~/lib/push-token"

/**
 * Has the server send the signed-in user's push notifications to this desktop app: at launch,
 * after signing in, once the API answers again after a failed attempt, and when the push
 * service registers the device while the app runs.
 */
export const usePushTokenRegistration = () => {
  const userId = useWhoami()?.id
  const pushConfigured = useServerCapability("push")
  const apiUnreachable = useApiUnreachable()

  useEffect(() => {
    if (!window.electron || !userId || !pushConfigured || apiUnreachable) return

    const register = () => {
      registerPushToken(userId).catch((error: unknown) => {
        console.error("The push token was not registered", error)
      })
    }
    register()
    return window.electron.on("push-token", register)
  }, [userId, pushConfigured, apiUnreachable])
}
