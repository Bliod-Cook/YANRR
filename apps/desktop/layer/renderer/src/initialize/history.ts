import type { createBrowserRouter } from "react-router"

declare global {
  interface History {
    /** Whether the page on screen was reached by going back or forward */
    readonly isPop: boolean
  }
}

type Router = Pick<ReturnType<typeof createBrowserRouter>, "state">

/** Tells code outside the router, such as the shared store, how the page on screen was reached */
export const exposeHistoryIsPop = (router: Router) => {
  Object.defineProperty(window.history, "isPop", {
    get: () => router.state.historyAction === "POP",
  })
}
