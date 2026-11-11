import type { FeedViewType } from "@follow/constants"
import { createElement, useCallback } from "react"
import { useTranslation } from "react-i18next"

import { MENU_ITEM_SEPARATOR, MenuItemSeparator, MenuItemText } from "~/atoms/context-menu"
import { HIDE_ACTIONS_IN_ENTRY_CONTEXT_MENU, useEntryActions } from "~/hooks/biz/useEntryActions"
import { useFeedActions } from "~/hooks/biz/useFeedActions"
import { useContextMenu } from "~/hooks/common/useContextMenu"
import { copyToClipboardWithFeedback } from "~/lib/clipboard"

import { useLazyContextMenu, useShowContextMenuOnMount } from "./useLazyContextMenu"

interface EntryContextMenuTarget {
  entryId: string
  view: FeedViewType
  feedId: string
}

const EntryContextMenu = ({
  entryId,
  view,
  feedId,
  event,
  onClosed,
}: EntryContextMenuTarget & { event: MouseEvent | React.MouseEvent; onClosed: () => void }) => {
  const { t } = useTranslation("common")
  const actionConfigs = useEntryActions({ entryId, view })
  const feedItems = useFeedActions({ feedId, view, type: "entryList" })

  useShowContextMenuOnMount(
    () => [
      ...actionConfigs.filter((item) => {
        if (item instanceof MenuItemSeparator) return true

        return !HIDE_ACTIONS_IN_ENTRY_CONTEXT_MENU.includes(item.id)
      }),
      MENU_ITEM_SEPARATOR,
      ...feedItems.filter((item) => {
        if (item instanceof MenuItemSeparator) return true

        return item && !item.disabled
      }),
      MENU_ITEM_SEPARATOR,
      new MenuItemText({
        label: `${t("words.copy")}${t("space")}${t("words.entry")} ${t("words.id")}`,
        click: () => copyToClipboardWithFeedback(entryId),
      }),
    ],
    event,
    onClosed,
  )

  return null
}

/**
 * The row's context menu. Its items are built when the menu is requested (right click, long
 * press or the toolbar's "more" button), not for every rendered row; render `contextMenuHost`
 * inside the row.
 */
export function useEntryContextMenu(target: EntryContextMenuTarget) {
  const { event, open, close, isOpen } = useLazyContextMenu()

  const contextMenuProps = useContextMenu({
    onContextMenu: (e) => {
      const $target = e.target as HTMLElement
      const selection = window.getSelection()
      if (selection) {
        const targetHasSelection =
          selection?.toString().length > 0 && $target.contains(selection?.anchorNode)
        if (targetHasSelection) {
          e.stopPropagation()
          return
        }
      }

      e.preventDefault()
      open(e)
    },
  })

  const openContextMenuAt = useCallback(
    (x: number, y: number) => {
      open(new MouseEvent("contextmenu", { clientX: x, clientY: y }))
    },
    [open],
  )

  return {
    contextMenuProps,
    isContextMenuOpen: isOpen,
    openContextMenuAt,
    contextMenuHost: event
      ? createElement(EntryContextMenu, { ...target, event, onClosed: close })
      : null,
  }
}
