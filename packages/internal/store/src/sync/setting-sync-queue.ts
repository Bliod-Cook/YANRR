import { EventBus } from "@follow/utils/event-bus"
import { jotaiStore } from "@follow/utils/jotai"
import type { SettingsTab } from "@follow-app/client-sdk"
import type { WritableAtom } from "jotai"

import { api } from "../context"
import { whoami } from "../modules/user/getters"
import { useUserStore } from "../modules/user/store"
import { registerSyncModel } from "./model-registry"
import type { SyncAction } from "./types"

/**
 * Settings sync between the devices of an account.
 *
 * A changed setting is sent alone, as the server merges a tab key by key. Until the server
 * confirmed it, the change is pending and keeps the server's value of that setting out.
 *
 * The server stamps a tab with its own clock whenever it changes. That stamp is the tab's
 * version: this device remembers the one its settings were last taken from, and takes a tab
 * when the server's version is newer. Versions are only compared with each other, never with
 * this device's clock.
 */

declare module "@follow/utils/event-bus" {
  interface CustomEvent {
    /** A setting was changed on this device. `key` names the settings atom it belongs to. */
    SETTING_CHANGE_EVENT: {
      key: string
      payload: Record<string, unknown>
    }
  }
}

type Settings = Record<string, unknown>

/** The settings of one atom and the server tab they are stored in. */
export interface SettingSyncDomain {
  tab: SettingsTab
  /** Any atom that holds a settings object. */
  atom: WritableAtom<object, [never], unknown>
  /** Settings that stay on this device. */
  localOnlyKeys?: readonly string[]
  /**
   * The domain's settings, for one that shares its tab with another domain: that one then
   * syncs every other setting of the tab.
   */
  keys?: readonly string[]
  /** Makes settings from the server safe to use, where the app cannot take them as they come. */
  normalize?: (settings: Settings) => object
}

export interface SettingSyncOptions {
  /** Where the queue keeps its state between launches. */
  storage: {
    read: () => string | null
    write: (value: string) => void
  }
  /** The synced settings atoms, by the key their changes are reported with. */
  domains: Record<string, SettingSyncDomain>
}

/** `failed`: the server could not be reached, and the pending changes are sent again later. */
export type SettingSyncStatus = "synced" | "pending" | "failed"

interface SettingSyncState {
  /** The account the changes and versions below belong to. */
  userId: string | null
  /** Changed settings the server has not confirmed yet, by tab. */
  pending: Record<string, Settings>
  /** The version of each tab that the settings on this device were last taken from. */
  versions: Record<string, string>
}

/** Changes are collected for this long before they are sent. */
const FLUSH_DELAY_MS = 1000
const BASE_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 60_000

const isEmpty = (object: object) => Object.keys(object).length === 0

const pick = (settings: Settings, predicate: (key: string) => boolean) =>
  Object.fromEntries(Object.entries(settings).filter(([key]) => predicate(key)))

/**
 * Coming back to the app or the network, in a browser. React Native has none of these events;
 * its app calls `resume` instead.
 */
const onReturn = (listener: () => void) => {
  if (typeof document === "undefined" || typeof globalThis.addEventListener !== "function") {
    return () => {}
  }

  const onVisibilityChange = () => {
    if (!document.hidden) listener()
  }
  window.addEventListener("online", listener)
  window.addEventListener("focus", listener)
  document.addEventListener("visibilitychange", onVisibilityChange)
  return () => {
    window.removeEventListener("online", listener)
    window.removeEventListener("focus", listener)
    document.removeEventListener("visibilitychange", onVisibilityChange)
  }
}

class SettingSyncQueue {
  private state: SettingSyncState
  /**
   * The change-log id of this device's last confirmed change to each tab. What the log
   * recorded before it is older than what the device has.
   */
  private confirmed: Record<string, number> = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing = false
  /** A change was made, or a retry asked for, while a flush was under way. */
  private flushAgain = false
  /** Failed flushes in a row; they set the delay before the next try. */
  private failures = 0
  private disposers: (() => void)[] = []
  private readonly listeners = new Set<() => void>()
  private readonly options: SettingSyncOptions

  constructor(options: SettingSyncOptions) {
    this.options = options
    // Not left to `init`: the sync engine starts before it and may report a tab by then, which
    // has to meet the changes still pending and is stored along with them.
    const stored = options.storage.read()
    const {
      userId = null,
      pending = {},
      versions = {},
    } = stored ? (JSON.parse(stored) as Partial<SettingSyncState>) : {}
    this.state = { userId, pending, versions }
  }

  /** Start following setting changes, and send what the last session could not. */
  init() {
    this.disposers.push(
      EventBus.subscribe("SETTING_CHANGE_EVENT", ({ key, payload }) => this.enqueue(key, payload)),
      onReturn(() => this.resume()),
      // Changes made before a session ended wait for their account to sign in again.
      useUserStore.subscribe((state, previous) => {
        if (state.whoami && !previous.whoami) this.resume()
      }),
    )
    this.resume()
  }

  teardown() {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.clearTimer()
  }

  /**
   * The network, the API, the app or the account came back: send what is pending now instead
   * of at the end of the back-off, which starts over.
   */
  resume() {
    this.failures = 0
    this.clearTimer()
    if (!isEmpty(this.state.pending)) this.schedule()
    this.notify()
  }

  readonly getStatus = (): SettingSyncStatus => {
    if (isEmpty(this.state.pending)) return "synced"
    return this.failures > 0 ? "failed" : "pending"
  }

  /** Calls `listener` whenever the status may have changed. */
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Take the account's settings from the server. Throws when they could not be read: the sync
   * engine must not count a load that did not happen as done.
   */
  async syncLocal() {
    const userId = whoami()?.id
    if (!userId) return

    const remote = await api().settings.get()
    this.bind(userId)
    for (const [tab, settings] of Object.entries(remote.settings)) {
      this.take(tab, remote.updated[tab as SettingsTab], settings)
    }
  }

  /**
   * One tab changed on the server, reported by the sync engine's change log. The action
   * carries what `GET /settings` would return for that tab, except for tabs that hold
   * credentials: those are logged without their settings and read the usual way.
   */
  async applyRemoteChange(action: SyncAction) {
    const userId = whoami()?.id
    const tab = action.modelId
    const data = action.data as { payload?: Settings; updatedAt?: string } | null
    if (action.action !== "U" || !tab || !data?.updatedAt || !userId) return

    this.bind(userId)
    // The log lags behind the answer to a change. An action from before it would bring back
    // the settings as they were then, until the action of the change itself arrives.
    if (action.id < (this.confirmed[tab] ?? 0)) return

    if (data.payload) {
      this.take(tab, data.updatedAt, data.payload)
    } else if (this.isNewer(tab, data.updatedAt)) {
      await this.syncLocal()
    }
  }

  private domainsOf(tab: string) {
    return Object.values(this.options.domains).filter((domain) => domain.tab === tab)
  }

  /** The settings of `domain` that sync, among those of its tab. */
  private pickSynced(domain: SettingSyncDomain, settings: Settings) {
    const keysOfOthers = this.domainsOf(domain.tab).flatMap((other) => other.keys ?? [])
    return pick(
      settings,
      (key) =>
        (domain.keys ? domain.keys.includes(key) : !keysOfOthers.includes(key)) &&
        !domain.localOnlyKeys?.includes(key),
    )
  }

  /** Whether the app syncs `tab` and has not taken this version of it, or a later one, yet. */
  private isNewer(tab: string, version: string) {
    const taken = this.state.versions[tab]
    return this.domainsOf(tab).length > 0 && !(taken && Date.parse(version) <= Date.parse(taken))
  }

  /**
   * Take a version of a tab from the server. A setting with a change of this device still
   * pending keeps its value here: that change goes to the server next and wins there.
   */
  private take(tab: string, version: string, settings: Settings) {
    if (!this.isNewer(tab, version)) return

    const pending = this.state.pending[tab] ?? {}
    const settled = pick(settings, (key) => !(key in pending))
    for (const domain of this.domainsOf(tab)) {
      const taken = this.pickSynced(domain, settled)
      if (isEmpty(taken)) continue
      const next = { ...jotaiStore.get(domain.atom), ...(domain.normalize?.(taken) ?? taken) }
      jotaiStore.set(domain.atom, next as never)
    }
    this.state.versions[tab] = version
    this.changed()
  }

  private enqueue(key: string, payload: Settings) {
    const domain = this.options.domains[key]
    const userId = whoami()?.id
    if (!domain || !userId) return

    const changes = this.pickSynced(domain, payload)
    if (isEmpty(changes)) return

    this.bind(userId)
    this.state.pending[domain.tab] = { ...this.state.pending[domain.tab], ...changes }
    this.changed()
    this.schedule()
  }

  /**
   * What is kept belongs to one account. Another one starts from scratch: the pending changes
   * are not its own, and the versions say nothing about its settings.
   */
  private bind(userId: string) {
    if (this.state.userId === userId) return
    this.state = { userId, pending: {}, versions: {} }
    this.confirmed = {}
  }

  private changed() {
    this.options.storage.write(JSON.stringify(this.state))
    this.notify()
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  private schedule(delay = FLUSH_DELAY_MS) {
    if (this.flushing) {
      this.flushAgain = true
      return
    }
    // A flush or retry that waits takes along the changes made until then.
    if (this.timer) return

    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, delay)
  }

  private clearTimer() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private async run() {
    this.flushing = true
    this.flushAgain = false
    const sent = await this.flush()
    this.flushing = false

    if (!sent) {
      // Try again later, waiting longer after each failure in a row.
      this.failures += 1
      this.schedule(Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** (this.failures - 1)))
    } else {
      this.failures = 0
      if (this.flushAgain) this.schedule()
    }
    this.notify()
  }

  /** Send the pending changes. Resolves to `false` when a tab could not be sent. */
  private async flush() {
    const userId = whoami()?.id
    // Signed out: the changes wait for their account.
    if (!userId) return true

    this.bind(userId)
    const results = await Promise.allSettled(
      Object.entries(this.state.pending).map(([tab, changes]) =>
        this.send(tab as SettingsTab, changes),
      ),
    )
    const failed = results.filter((result) => result.status === "rejected")
    for (const { reason } of failed) {
      console.error("[setting-sync] failed to send settings", reason)
    }
    return failed.length === 0
  }

  private async send(tab: SettingsTab, changes: Settings) {
    const { state } = this
    const { lastSyncId } = await api().settings.update({ tab, ...changes })
    // Another account signed in meanwhile.
    if (this.state !== state) return

    // A setting that changed again while the request was on its way stays pending.
    const waiting = state.pending[tab] ?? {}
    const left = pick(waiting, (key) => waiting[key] !== changes[key])
    if (isEmpty(left)) {
      delete state.pending[tab]
    } else {
      state.pending[tab] = left
    }
    if (lastSyncId !== undefined) this.confirmed[tab] = lastSyncId
    this.changed()
  }
}

export type { SettingSyncQueue }

export const createSettingSyncQueue = (options: SettingSyncOptions) => {
  const queue = new SettingSyncQueue(options)
  // Registered when the app's module loads, before the sync engine starts: once the settings
  // were loaded in full, launches no longer request them and other devices' changes arrive
  // through the change log.
  registerSyncModel("setting", {
    bootstrap: () => queue.syncLocal(),
    apply: (action) => queue.applyRemoteChange(action),
  })
  return queue
}
