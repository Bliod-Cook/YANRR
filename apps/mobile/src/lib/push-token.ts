import { api } from "@follow/store/context"
import { Platform } from "react-native"

import { kv } from "./kv"

/** Where the device keeps the push token it registered: `{ userId, token }` as JSON */
export const PUSH_TOKEN_STORAGE_KEY = "firebase_messaging_token"

/** How long a sign-out waits for the server to forget the device, so one offline is not held up */
const UNREGISTER_TIMEOUT_MS = 5000

interface RegisteredPushToken {
  userId: string
  token: string
}

const getRegisteredPushToken = (): RegisteredPushToken | null => {
  const stored = kv.getSync(PUSH_TOKEN_STORAGE_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as RegisteredPushToken
  } catch {
    // Older versions kept the bare token
    return null
  }
}

/** Registers the device's token for the account, unless the server has it for that account already */
export const registerPushToken = async (userId: string, token: string) => {
  const registered = getRegisteredPushToken()
  if (registered?.userId === userId && registered.token === token) return

  await api().messaging.createToken({ token, channel: Platform.OS })
  await kv.set(
    PUSH_TOKEN_STORAGE_KEY,
    JSON.stringify({ userId, token } satisfies RegisteredPushToken),
  )
}

/**
 * Stops push notifications to this device for the account signing out. The server keeps a
 * device's token until another account registers it, so without this the device would go on
 * getting the notifications of an account no longer signed in on it. Call it while the session
 * still authorizes the request.
 *
 * Only this device's token is removed, so a device that never registered one removes nothing.
 */
export const unregisterPushToken = async () => {
  try {
    const registered = getRegisteredPushToken()
    if (!registered) return
    await api().messaging.deleteToken(
      { token: registered.token },
      { timeout: UNREGISTER_TIMEOUT_MS },
    )
    await kv.delete(PUSH_TOKEN_STORAGE_KEY)
  } catch (error) {
    console.warn(
      `[auth] Push token removal failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
