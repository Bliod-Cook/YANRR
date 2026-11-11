import { createElement, lazy, Suspense, useState } from "react"

const LazyContextMenuProvider = lazy(() =>
  import("./../context-menu-provider").then((res) => ({
    default: res.ContextMenuProvider,
  })),
)
const LazyPopoverProvider = lazy(() =>
  import("./../popover-provider").then((res) => ({
    default: res.PopoverProvider,
  })),
)

const LazyPWAPromptImport = lazy(() => import("react-ios-pwa-prompt"))

const LazyPWAPrompt = () => {
  const [show, setShow] = useState(true)
  if (!show) return null
  return createElement(
    Suspense,
    null,
    createElement(LazyPWAPromptImport, {
      onClose() {
        setTimeout(() => {
          setShow(false)
        }, 250)
      },

      appIconPath: `${window.location.origin}/apple-touch-icon-180x180.png`,
    }),
  )
}

export { LazyContextMenuProvider, LazyPopoverProvider, LazyPWAPrompt }
