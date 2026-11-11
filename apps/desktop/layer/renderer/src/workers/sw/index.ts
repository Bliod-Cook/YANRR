/// <reference lib="webworker" />
import { registerPusher } from "./pusher"

declare let self: ServiceWorkerGlobalScope

registerPusher(self)

// It caches nothing a running page depends on, so a new version can take over at once
self.addEventListener("install", () => {
  void self.skipWaiting()
})

// Older versions kept images under this name
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("image-assets"))
})
