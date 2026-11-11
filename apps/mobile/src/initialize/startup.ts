import { useSyncExternalStore } from "react"

interface StartupState {
  /** The database is migrated and the stores are hydrated */
  ready: boolean
  error: Error | null
}

const listeners = new Set<() => void>()
const subscribe = (onStoreChange: () => void) => {
  listeners.add(onStoreChange)

  return () => {
    listeners.delete(onStoreChange)
  }
}
let startupState: StartupState = { ready: false, error: null }

let settleReady!: { resolve: () => void; reject: (error: Error) => void }
/** Settles once the startup finished, for code that runs without a screen, such as background tasks */
export const appReady = new Promise<void>((resolve, reject) => {
  settleReady = { resolve, reject }
})
// Rejected for those who wait; nobody has to
appReady.catch(() => {})

// useSyncExternalStore compares snapshots by identity. Mutating the previous
// object leaves subscribers stuck on the startup screen during cold starts.
const setStartupState = (state: StartupState) => {
  startupState = state
  listeners.forEach((listener) => listener())
}

export const setStartupReady = () => {
  setStartupState({ ready: true, error: null })
  settleReady.resolve()
}

export const setStartupFailed = (error: Error) => {
  setStartupState({ ready: false, error })
  settleReady.reject(error)
}

const getSnapshot = () => startupState
export const useStartupState = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
