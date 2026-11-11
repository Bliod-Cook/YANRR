// What a page may say to the main process and hear from it. Without imports, so that the
// preload script, which hands pages nothing else, shares it with the main process.

/** The groups of the IPC services, whose methods a page calls as `<group>.<method>` */
export const IPC_SERVICE_GROUPS = [
  "app",
  "auth",
  "debug",
  "dock",
  "integration",
  "menu",
  "reader",
  "setting",
] as const

export const FindBarChannel = {
  /** Page to main: find `{ text, direction }` */
  find: "find-bar:find",
  /** Page to main: the text was emptied */
  clear: "find-bar:clear",
  /** Page to main: Escape or the close button */
  close: "find-bar:close",
  /** Main to page: shown, `{ labels, accent }` */
  open: "find-bar:open",
  /** Main to page: `{ activeMatchOrdinal, matches }` */
  result: "find-bar:result",
} as const

/** Main to page: an item of the menu `menu.showContextMenu` opened was chosen, `{ path }` */
export const MENU_CLICK_CHANNEL = "menu-click"

export const CHANNELS_FROM_PAGE: readonly string[] = [
  FindBarChannel.find,
  FindBarChannel.clear,
  FindBarChannel.close,
]

export const CHANNELS_TO_PAGE: readonly string[] = [
  FindBarChannel.open,
  FindBarChannel.result,
  MENU_CLICK_CHANNEL,
]
