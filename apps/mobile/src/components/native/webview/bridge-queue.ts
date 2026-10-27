/**
 * Messages for the page of an Android WebView, which drops them until the page installed its
 * bridge. Every message sets something, so the latest of each type is kept and sent once the page
 * says its bridge is ready, again after each reload.
 */
export const createBridgeQueue = (send: (type: string, payload?: string) => void) => {
  const latest = new Map<string, string | undefined>()
  let isReady = false

  return {
    dispatch(type: string, payload?: string) {
      latest.set(type, payload)
      if (isReady) send(type, payload)
    },
    ready() {
      isReady = true
      for (const [type, payload] of latest) send(type, payload)
    },
    reset() {
      isReady = false
    },
  }
}
