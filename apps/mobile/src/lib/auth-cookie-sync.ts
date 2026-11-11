import { storageAdapter } from "@better-auth/expo/client"

type StoredCookie = Record<
  string,
  {
    expires: string | null
    value: string
  }
>

const parseStoredCookie = (cookie: string | null | undefined): StoredCookie | null => {
  if (!cookie) {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(cookie)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    for (const value of Object.values(parsed)) {
      if (
        !value ||
        typeof value !== "object" ||
        !("value" in value) ||
        typeof value.value !== "string" ||
        !("expires" in value) ||
        (value.expires !== null && typeof value.expires !== "string")
      ) {
        return null
      }
    }

    return parsed as StoredCookie
  } catch {
    return null
  }
}

const isSessionCookieName = (name: string) =>
  name.includes("session_token") || name.includes("session_data")

// Session responses routinely extend cookie expiry without changing the signed-in user.
export const hasAuthSessionChanged = (
  previousCookie: string | null | undefined,
  nextCookie: string | null | undefined,
) => {
  const previous = parseStoredCookie(previousCookie)
  const next = parseStoredCookie(nextCookie)
  if (!previous || !next) {
    return true
  }

  const sessionCookieNames = new Set(
    [...Object.keys(previous), ...Object.keys(next)].filter(isSessionCookieName),
  )
  return Array.from(sessionCookieNames).some((name) => previous[name]?.value !== next[name]?.value)
}

interface AuthStorage {
  /** `null` when there is no value; throws when it could not be read */
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * The storage the Expo plugin of Better Auth keeps the cookie in, telling when a write replaced
 * the session. A response that only extends the session is no change.
 */
export const createSessionAwareAuthCookieStorage = ({
  cookieKey,
  storage,
  onSessionChange,
}: {
  cookieKey: string
  storage: AuthStorage
  onSessionChange: () => void
}) => {
  // The cookie before the write, read the first time the cookie changes: a read at start-up
  // could fail, as in a background task before the first unlock
  let observedCookie: string | null | undefined

  const sessionStorage = {
    getItem: (key: string) => storage.getItem(key),
    getItemAsync: async (key: string) => storage.getItem(key),
    setItem(key: string, value: string) {
      if (key !== cookieKey) {
        storage.setItem(key, value)
        return
      }

      observedCookie ??= cookie.getItem(cookieKey)
      storage.setItem(key, value)
      // The plugin writes a cookie too large for one entry in chunks, and this key last
      const nextCookie = cookie.getItem(cookieKey)
      if (nextCookie === null) {
        return
      }

      const previousCookie = observedCookie
      observedCookie = nextCookie
      if (hasAuthSessionChanged(previousCookie, nextCookie)) {
        onSessionChange()
      }
    },
    setItemAsync: async (key: string, value: string) => sessionStorage.setItem(key, value),
  }
  // Reads the cookie the way the plugin stored it
  const cookie = storageAdapter(sessionStorage)
  return sessionStorage
}
