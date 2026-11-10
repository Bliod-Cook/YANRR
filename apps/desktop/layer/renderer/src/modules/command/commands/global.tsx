import { EventBus } from "@follow/utils/event-bus"
import { useTranslation } from "react-i18next"

import { setAppSearchOpen, setAppSearchScope } from "~/atoms/app"
import { getAIPanelVisibility, setAIPanelVisibility } from "~/atoms/settings/ai"
import { getRouteParams } from "~/hooks/biz/useRouteParams"
import { useShortcutsModal } from "~/modules/modal/hooks/useShortcutsModal"
import { routeSearchScope } from "~/modules/panel/search-scope"

import { useRegisterCommandEffect } from "../hooks/use-register-command"
import type { Command, CommandCategory } from "../types"
import { COMMAND_ID } from "./id"

declare module "@follow/utils/event-bus" {
  interface EventBusMap {
    "global:toggle-corner-play": void
    "global:quick-add": void
  }
}

const category: CommandCategory = "category.global"
export const useRegisterGlobalCommands = () => {
  const showShortcuts = useShortcutsModal()
  const { t } = useTranslation("shortcuts")

  useRegisterCommandEffect([
    {
      id: COMMAND_ID.global.showShortcuts,
      label: {
        title: t("command.global.show_shortcuts.title"),
        description: t("command.global.show_shortcuts.description"),
      },

      run: () => {
        showShortcuts()
      },
      category,
    },
    {
      id: COMMAND_ID.global.toggleCornerPlay,
      label: {
        title: t("command.global.toggle_corner_play.title"),
        description: t("command.global.toggle_corner_play.description"),
      },
      run: () => {
        EventBus.dispatch(COMMAND_ID.global.toggleCornerPlay)
      },
      category,
    },
    {
      id: COMMAND_ID.global.quickAdd,
      label: {
        title: t("command.global.quick_add.title"),
        description: t("command.global.quick_add.description"),
      },
      run: () => {
        EventBus.dispatch(COMMAND_ID.global.quickAdd)
      },
      category,
    },

    {
      id: COMMAND_ID.global.quickSearch,
      label: {
        title: t("command.global.quick_search.title"),
        description: t("command.global.quick_search.description"),
      },
      run: () => {
        setAppSearchScope(null)
        setAppSearchOpen(true)
      },
      category,
    },
    {
      id: COMMAND_ID.global.quickSearchInView,
      label: {
        title: t("command.global.quick_search_in_view.title"),
        description: t("command.global.quick_search_in_view.description"),
      },
      run: () => {
        setAppSearchScope(routeSearchScope(getRouteParams()))
        setAppSearchOpen(true)
      },
      category,
    },

    {
      id: COMMAND_ID.global.toggleAIChat,
      label: {
        title: t("command.global.toggle_ai_chat.title"),
        description: t("command.global.toggle_ai_chat.description"),
      },
      run: () => {
        const isVisible = getAIPanelVisibility()
        setAIPanelVisibility(!isVisible)
      },

      category,
    },
  ])
}

export type ShowShortcutsCommand = Command<{
  id: typeof COMMAND_ID.global.showShortcuts
  fn: () => void
}>

export type ToggleCornerPlayCommand = Command<{
  id: typeof COMMAND_ID.global.toggleCornerPlay
  fn: () => void
}>

export type QuickAddCommand = Command<{
  id: typeof COMMAND_ID.global.quickAdd
  fn: () => void
}>

export type ToggleAIChatCommand = Command<{
  id: typeof COMMAND_ID.global.toggleAIChat
  fn: (ctx?: { entryId?: string }) => void
}>

export type QuickSearchCommand = Command<{
  id: typeof COMMAND_ID.global.quickSearch
  fn: () => void
}>

export type QuickSearchInViewCommand = Command<{
  id: typeof COMMAND_ID.global.quickSearchInView
  fn: () => void
}>

export type GlobalCommand =
  | ShowShortcutsCommand
  | ToggleCornerPlayCommand
  | QuickAddCommand
  | ToggleAIChatCommand
  | QuickSearchCommand
  | QuickSearchInViewCommand
