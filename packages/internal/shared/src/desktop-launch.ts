// Kept in a module without build-time globals so that both Electron layers can import it.

/** Hands the server's address to a window's preload script, which runs before the renderer */
export const SERVER_URL_ARG = "--yanrr-server="
