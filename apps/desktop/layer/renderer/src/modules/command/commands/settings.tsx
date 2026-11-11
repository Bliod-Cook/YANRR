import { useTranslation } from "react-i18next"

import { useShowCustomizeToolbarModal } from "~/modules/customize-toolbar/modal"

import { useRegisterCommandEffect } from "../hooks/use-register-command"
import type { Command, CommandCategory } from "../types"
import { COMMAND_ID } from "./id"

export const useRegisterSettingsCommands = () => {
  useCustomizeToolbarCommand()
}

const category: CommandCategory = "category.settings"
const useCustomizeToolbarCommand = () => {
  const [t] = useTranslation("settings")
  const showModal = useShowCustomizeToolbarModal()
  useRegisterCommandEffect([
    {
      id: COMMAND_ID.settings.customizeToolbar,
      label: t("customizeToolbar.title"),
      category,
      icon: <i className="i-mgc-settings-7-cute-re" />,
      run() {
        showModal()
      },
    },
  ])
}

export type CustomizeToolbarCommand = Command<{
  id: typeof COMMAND_ID.settings.customizeToolbar
  fn: () => void
}>

export type SettingsCommand = CustomizeToolbarCommand
