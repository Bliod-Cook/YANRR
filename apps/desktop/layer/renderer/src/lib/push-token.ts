import { api } from "@follow/store/context"
import { getStorageNS } from "@follow/utils/ns"
import type { MessagingChannel } from "@follow-app/client-sdk"

import { ipcServices } from "./client"

// The desktop app's push notifications. The main process receives the device's token from the
// push service (see `setting.getMessagingToken`); the page tells the server, as the user who is
// signed in.

/** The server's push channel of each system the app runs on */
const PUSH_CHANNELS: Partial<Record<NodeJS.Platform, MessagingChannel>> = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
}

/** The user and token the server has from this device, so a launch does not register again */
const REGISTRATION_KEY = getStorageNS("push_token_registration")

/** How long a sign-out waits for the server to forget the device, so one offline is not held up */
const UNREGISTER_TIMEOUT_MS = 5000

/** Registers the device's token for the user, unless the server has it for that user already */
export const registerPushToken = async (userId: string) => {
  const token = await ipcServices?.setting.getMessagingToken()
  if (!token) return
  const registration = JSON.stringify({ userId, token })
  if (localStorage.getItem(REGISTRATION_KEY) === registration) return

  await api().messaging.createToken({
    token,
    channel: PUSH_CHANNELS[window.platform] ?? "desktop",
  })
  localStorage.setItem(REGISTRATION_KEY, registration)
}

/**
 * Stops the notifications of the account signing out to this device. Call it while the session
 * still authorizes the request: the server removes this device's token only.
 */
export const unregisterPushToken = async () => {
  const token = await ipcServices?.setting.getMessagingToken()
  if (!token) return
  await api().messaging.deleteToken({ token }, { timeout: UNREGISTER_TIMEOUT_MS })
  localStorage.removeItem(REGISTRATION_KEY)
}
