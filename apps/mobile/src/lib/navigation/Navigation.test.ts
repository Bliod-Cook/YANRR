import { jotaiStore } from "@follow/utils"
import { atom } from "jotai"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Route } from "./ChainNavigationContext"
import { Navigation } from "./Navigation"
import type { NavigationControllerView } from "./types"

// expo's EventEmitter is a host object of the native runtime
vi.mock("expo", async () => {
  const { EventEmitter } = await import("node:events")
  return {
    EventEmitter: class {
      private emitter = new EventEmitter()

      addListener(event: string, listener: (payload: unknown) => void) {
        this.emitter.on(event, listener)
        return { remove: () => this.emitter.off(event, listener) }
      }

      emit(event: string, payload: unknown) {
        this.emitter.emit(event, payload)
      }
    },
  }
})

const EntryScreen: NavigationControllerView<{ entryId: string }> = () => null
const FeedScreen: NavigationControllerView = () => null
const FormScreen: NavigationControllerView = () => null

describe("Navigation", () => {
  let navigation: Navigation
  let changes: string[]

  const routes = () => jotaiStore.get(navigation.__dangerous_getCtxValue().routesAtom)
  const screens = () => routes().map((route) => route.Component)
  const nameOf = (route: Route) =>
    route.Component === EntryScreen
      ? `entry ${(route.props as { entryId: string }).entryId}`
      : route.Component?.name

  beforeEach(() => {
    navigation = new Navigation({ routesAtom: atom<Route[]>([]) })
    changes = []
    navigation.on("screenChange", ({ type, route }) => {
      changes.push(`${type} ${route ? nameOf(route) : ""}`)
    })
  })

  it("pushes the screen on top again for other props, such as another entry", () => {
    navigation.pushControllerView(EntryScreen, { entryId: "1" })
    navigation.pushControllerView(EntryScreen, { entryId: "2" })

    expect(routes().map((route) => route.props)).toEqual([{ entryId: "1" }, { entryId: "2" }])
    expect(new Set(routes().map((route) => route.id)).size).toBe(2)
    expect(changes).toEqual(["appear entry 1", "appear entry 2"])
  })

  it("drops a push of the screen on top with the same props, as from a double tap", () => {
    navigation.pushControllerView(EntryScreen, { entryId: "1" })
    navigation.pushControllerView(EntryScreen, { entryId: "1" })
    navigation.pushControllerView(FeedScreen)
    navigation.pushControllerView(FeedScreen)

    expect(screens()).toEqual([EntryScreen, FeedScreen])
  })

  it("replaces the top screen with a route of its own", () => {
    navigation.pushControllerView(EntryScreen, { entryId: "1" })
    const [replaced] = routes()
    navigation.replaceControllerView(EntryScreen, { entryId: "2" })

    expect(routes()).toHaveLength(1)
    expect(routes()[0]!.id).not.toBe(replaced!.id)
    expect(changes).toEqual(["appear entry 1", "disappear entry 1", "appear entry 2"])
  })

  it("dismisses the top modal with the screens pushed onto it", () => {
    navigation.pushControllerView(FeedScreen)
    navigation.presentControllerView(FormScreen)
    navigation.pushControllerView(EntryScreen, { entryId: "1" })
    changes = []

    navigation.dismiss()

    expect(screens()).toEqual([FeedScreen])
    expect(changes).toEqual(["disappear entry 1", "disappear FormScreen"])
  })

  it("pops to the root, telling about every screen that went", () => {
    navigation.pushControllerView(FeedScreen)
    navigation.pushControllerView(EntryScreen, { entryId: "1" })
    changes = []

    navigation.popToRoot()

    expect(routes()).toEqual([])
    expect(changes).toEqual(["disappear entry 1", "disappear FeedScreen"])
  })

  it("removes as many screens as a native back gesture popped at once", () => {
    navigation.pushControllerView(FeedScreen)
    navigation.pushControllerView(EntryScreen, { entryId: "1" })
    navigation.pushControllerView(EntryScreen, { entryId: "2" })
    changes = []

    // A long press on the iOS back button pops several screens; the top one reports how many
    navigation.__internal_dismiss(routes()[2]!.id, 2)

    expect(screens()).toEqual([FeedScreen])
    expect(changes).toEqual(["disappear entry 2", "disappear entry 1"])
  })
})
