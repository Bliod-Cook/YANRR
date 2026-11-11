import { useCallback, useEffect, useRef, useState } from "react"

import type { MenuItemInput } from "~/atoms/context-menu"
import { useShowContextMenu } from "~/atoms/context-menu"

type MenuEvent = MouseEvent | React.MouseEvent

/**
 * Open state for a context menu whose items are only built once it is requested: the row renders
 * a host component (which owns the menu hooks) while `event` is set.
 */
export const useLazyContextMenu = () => {
  const [event, setEvent] = useState<MenuEvent | null>(null)
  const close = useCallback(() => setEvent(null), [])
  return { event, open: setEvent, close, isOpen: event !== null }
}

/** Shows the menu once on mount and calls `onClosed` when it is dismissed. */
export const useShowContextMenuOnMount = (
  buildItems: () => MenuItemInput[],
  event: MenuEvent,
  onClosed: () => void,
) => {
  const showContextMenu = useShowContextMenu()
  const shownRef = useRef(false)

  useEffect(() => {
    if (shownRef.current) return
    shownRef.current = true
    void showContextMenu(buildItems(), event).finally(onClosed)
    // The menu is built from the render that requested it and shown once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
