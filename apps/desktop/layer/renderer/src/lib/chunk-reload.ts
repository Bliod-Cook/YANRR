const RELOAD_MARKER = "chunk-reload"

/**
 * A new deployment removes the old chunk files, so a long-lived tab fails to load them. Reload
 * once to pick up the new build; the marker stops a reload loop when the failure persists.
 */
export const installChunkReloadHandler = () => {
  window.addEventListener("vite:preloadError", (event) => {
    if (sessionStorage.getItem(RELOAD_MARKER)) return
    event.preventDefault()
    sessionStorage.setItem(RELOAD_MARKER, "1")
    window.location.reload()
  })
}

export const clearChunkReloadMarker = () => {
  sessionStorage.removeItem(RELOAD_MARKER)
}
