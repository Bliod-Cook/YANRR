import { atom } from "jotai"

import { createAtomHooks } from "~/lib/jotai"

// Set once a new web app version waits in the service worker; `finishUpdate` activates it
type PwaUpdate = { finishUpdate: () => void }

export const [, , usePwaUpdate, , , setPwaUpdate] = createAtomHooks(atom<PwaUpdate | null>(null))
