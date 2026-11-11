export const UNREAD_BACKGROUND_POLLING_INTERVAL = 1000 * 60 * 5

/**
 * Launch argument that makes the app start hidden in the tray. It is registered as the argument
 * of the login item and checked for on startup.
 *
 * @see https://github.com/electron/electron/issues/25081
 */
export const START_IN_TRAY_ARGS = "--start-in-tray"
