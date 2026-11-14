/**
 * The server's clock, as told by its answers to the sync engine. Entries carry the time the
 * server took them in, which only compares with that clock: the device's may be minutes off.
 * Kept in its own module, without imports, so that stores reach it without an import cycle.
 */
let offset = 0

/** How far the server's clock is ahead of the device's, in milliseconds */
export const getServerClockOffset = () => offset

export const setServerClockOffset = (next: number) => {
  offset = next
}

/** The time on the server's clock, in milliseconds */
export const serverNow = () => Date.now() + offset
