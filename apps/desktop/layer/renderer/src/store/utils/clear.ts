import { deleteDB } from "@follow/database/db"
import { clearStorage } from "@follow/utils/ns"

import { QUERY_PERSIST_KEY } from "~/constants"
import {
  clearAuthSessionToken,
  getAuthSessionToken,
  setAuthSessionToken,
} from "~/lib/client-session"
import { reloadAtAppRoot } from "~/lib/reload-at-app-root"

import { clearImageDimensionsDb } from "../image/db"

export const clearLocalPersistStoreData = async () => {
  await Promise.all([deleteDB(), clearImageDimensionsDb()])
}

/** Everything of the session on this device, as a sign-out leaves it: data, cache and settings */
export const clearLocalSessionData = async () => {
  clearAuthSessionToken()
  localStorage.removeItem(QUERY_PERSIST_KEY)
  await clearLocalPersistStoreData()
  clearStorage()
}

/**
 * Signed in to another account than the one whose data is in the local database, after that
 * one's session ended without a sign-out. The data on screen, the changes still queued and the
 * settings belong to the account before, so start over as a sign-out does, keeping the new
 * session. Settings left in place would be uploaded to the new account on its first sync, AI
 * provider keys included, and its integrations would save to the other account's services.
 */
export const clearLocalDataOfAnotherAccount = async () => {
  await clearLocalPersistStoreData()
  const authSessionToken = getAuthSessionToken()
  // The query cache and every setting of the account before, as a sign-out clears them
  clearStorage()
  if (authSessionToken) setAuthSessionToken(authSessionToken)
  reloadAtAppRoot()
}
