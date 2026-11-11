import { jotaiStore } from "@follow/utils"
import { EventEmitter } from "expo"
import { atom } from "jotai"

import type { ChainNavigationContextType, Route } from "./ChainNavigationContext"
import type {
  NavigationControllerView,
  NavigationControllerViewExtraProps,
  NavigationControllerViewType,
} from "./types"

/** Whether pushing these props again would show the same as the screen on top */
const haveSameProps = (left: unknown, right: unknown) => {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false
  const leftProps = left as Record<string, unknown>
  const rightProps = right as Record<string, unknown>
  const keys = Object.keys(leftProps)
  return (
    keys.length === Object.keys(rightProps).length &&
    keys.every((key) => Object.is(leftProps[key], rightProps[key]))
  )
}

export class Navigation {
  private ctxValue: ChainNavigationContextType
  constructor(ctxValue: ChainNavigationContextType) {
    this.ctxValue = ctxValue

    this.pushControllerView = this.pushControllerView.bind(this)
    this.presentControllerView = this.presentControllerView.bind(this)
    this.dismiss = this.dismiss.bind(this)
    this.back = this.back.bind(this)
    this.popToRoot = this.popToRoot.bind(this)
  }

  __dangerous_getCtxValue() {
    return this.ctxValue
  }

  private routeCount = 0

  static readonly rootNavigation: Navigation = new Navigation({
    routesAtom: atom<Route[]>([]),
  })

  private getRoutes() {
    return jotaiStore.get(this.ctxValue.routesAtom)
  }

  /** The screens that left the stack disappear, the top one first, then the new ones appear. */
  private setRoutes(routes: Route[]) {
    const previousRoutes = this.getRoutes()
    jotaiStore.set(this.ctxValue.routesAtom, routes)
    for (const route of previousRoutes.filter((route) => !routes.includes(route)).reverse()) {
      this.emit("screenChange", { screenId: route.id, type: "disappear", route })
    }
    for (const route of routes.filter((route) => !previousRoutes.includes(route))) {
      this.emit("screenChange", { screenId: route.id, type: "appear", route })
    }
  }

  private createRoute<T>(
    view: NavigationControllerView<T>,
    props: T | undefined,
    type: NavigationControllerViewType,
    screenOptions?: NavigationControllerViewExtraProps,
  ): Route {
    return {
      // Its own for every push, as one screen may be on the stack several times
      id: `${view.displayName || view.name || "view"}-${this.routeCount++}`,
      type,
      Component: view,
      props,
      screenOptions: { ...this.resolveScreenOptions(view), ...screenOptions },
    }
  }

  private resolveScreenOptions<T>(
    view: NavigationControllerView<T>,
  ): Required<NavigationControllerViewExtraProps> {
    return {
      transparent: view.transparent ?? false,
      title: view.title ?? "",
      // Form Sheet
      sheetAllowedDetents: view.sheetAllowedDetents ?? "fitToContents",
      sheetCornerRadius: view.sheetCornerRadius ?? 16,
      sheetExpandsWhenScrolledToEdge: view.sheetExpandsWhenScrolledToEdge ?? true,
      sheetElevation: view.sheetElevation ?? 24,
      sheetGrabberVisible: view.sheetGrabberVisible ?? true,
      sheetInitialDetentIndex: view.sheetInitialDetentIndex ?? 0,
      sheetLargestUndimmedDetentIndex: view.sheetLargestUndimmedDetentIndex ?? "medium",
      // Transition-related props
      stackAnimation: view.stackAnimation ?? "default",
      // Default to "pop" but we specified it as "push" making it more intuitive
      replaceAnimation: view.replaceAnimation ?? "push",
      transitionDuration: view.transitionDuration ?? 500,
    }
  }

  private __push<T>(
    view: NavigationControllerView<T>,
    props: T | undefined,
    type: NavigationControllerViewType,
  ) {
    const routes = this.getRoutes()
    const topRoute = routes.at(-1)
    // A second tap before the screen showed asks for the same screen again
    if (topRoute?.Component === view && haveSameProps(topRoute.props, props)) return
    this.setRoutes([...routes, this.createRoute(view, props, type)])
  }

  pushControllerView<T>(view: NavigationControllerView<T>, props?: T) {
    this.__push(view, props, "push")
  }

  replaceControllerView<T>(
    view: NavigationControllerView<T>,
    props?: T,
    extractScreenOptions?: NavigationControllerViewExtraProps,
  ) {
    const routes = this.getRoutes()
    this.setRoutes([
      ...routes.slice(0, -1),
      this.createRoute(view, props, "push", extractScreenOptions),
    ])
  }

  presentControllerView<T>(
    view: NavigationControllerView<T>,
    props?: T,
    type: Exclude<NavigationControllerViewType, "push"> = "modal",
  ) {
    this.__push(view, props, type)
  }

  /**
   * Dismiss the current modal.
   */
  dismiss() {
    const routes = this.getRoutes()
    const lastModalIndex = routes.findLastIndex((r) => r.type !== "push")
    if (lastModalIndex === -1) {
      return
    }
    this.setRoutes(routes.slice(0, lastModalIndex))
  }

  back() {
    const routes = this.getRoutes()
    if (routes.length === 0) {
      return
    }
    this.setRoutes(routes.slice(0, -1))
  }

  /**
   * Removes the route with the screens over it, and as many more below it as `count` says: a
   * native back gesture can pop several screens at once and reports it on the top one.
   */
  __internal_dismiss(routeId: string, count = 1) {
    const routes = this.getRoutes()
    const index = routes.findIndex((r) => r.id === routeId)
    if (index === -1) {
      return
    }
    this.setRoutes(routes.slice(0, Math.max(0, index - count + 1)))
  }

  private bus = new EventEmitter<{
    willAppear: (payload: LifecycleEventPayload) => void
    didAppear: (payload: LifecycleEventPayload) => void
    willDisappear: (payload: LifecycleEventPayload) => void
    didDisappear: (payload: LifecycleEventPayload) => void
  }>()
  on(event: "willAppear", callback: (payload: LifecycleEventPayload) => void): Disposer
  on(event: "didAppear", callback: (payload: LifecycleEventPayload) => void): Disposer
  on(event: "willDisappear", callback: (payload: LifecycleEventPayload) => void): Disposer
  on(event: "didDisappear", callback: (payload: LifecycleEventPayload) => void): Disposer
  on(event: "screenChange", callback: (payload: ScreenChangeEventPayload) => void): Disposer
  on(event: string, callback: (payload: any) => void): Disposer {
    const subscription = this.bus.addListener(event as any, callback)
    return () => {
      subscription.remove()
    }
  }

  emit(event: "willAppear", payload: LifecycleEventPayload): void
  emit(event: "didAppear", payload: LifecycleEventPayload): void
  emit(event: "willDisappear", payload: LifecycleEventPayload): void
  emit(event: "didDisappear", payload: LifecycleEventPayload): void
  emit(event: "screenChange", payload: ScreenChangeEventPayload): void
  emit(event: string, payload: LifecycleEventPayload): void {
    this.bus.emit(event as any, payload)
  }

  canGoBack() {
    return this.getRoutes().length > 0
  }

  hasControllerView<T>(view: NavigationControllerView<T>) {
    return this.getRoutes().some((route) => route.Component === view)
  }

  popToRoot() {
    this.setRoutes([])
  }
}

type Disposer = () => void

type LifecycleEventPayload = {
  screenId: string
}

type ScreenChangeEventPayload = {
  screenId: string
  type: "appear" | "disappear"
  route?: Route
}
