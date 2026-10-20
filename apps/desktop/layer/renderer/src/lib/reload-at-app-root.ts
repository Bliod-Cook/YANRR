import { IN_ELECTRON } from "@follow/shared/constants"

/**
 * Reload on the app's start page. After the account changed, the page that was open, such as
 * an entry of one of its feeds, belongs to the account before: opened again, it would show to
 * the next account and be marked read for it.
 */
export const reloadAtAppRoot = () => {
  // The desktop app keeps the route in the hash (see router.tsx)
  window.history.replaceState(null, "", IN_ELECTRON ? "#/" : "/")
  window.location.reload()
}
