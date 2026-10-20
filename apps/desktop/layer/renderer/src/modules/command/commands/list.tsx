import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { useNavigateEntry } from "~/hooks/biz/useNavigateEntry"
import { useDeleteSubscription } from "~/hooks/biz/useSubscriptionActions"
import { copyToClipboard } from "~/lib/clipboard"
import { ListForm } from "~/modules/discover/ListForm"

import { useRegisterCommandEffect } from "../hooks/use-register-command"
import type { CommandCategory } from "../types"
import { COMMAND_ID } from "./id"

const category: CommandCategory = "category.list"
export const useRegisterListCommands = () => {
  const { t } = useTranslation()

  const { mutateAsync: deleteSubscription } = useDeleteSubscription()
  const navigateEntry = useNavigateEntry()
  const { present } = useModalStack()

  useRegisterCommandEffect([
    {
      id: COMMAND_ID.list.edit,
      label: t("sidebar.feed_actions.edit"),
      category,
      run: ({ listId }) => {
        if (!listId) return
        present({
          title: t("sidebar.feed_actions.edit_list"),
          content: ({ dismiss }) => <ListForm id={listId} onSuccess={dismiss} />,
        })
      },
    },
    {
      id: COMMAND_ID.list.unfollow,
      label: t("sidebar.feed_actions.unfollow"),
      category,
      run: ({ subscription }) => deleteSubscription({ subscription }),
    },
    {
      id: COMMAND_ID.list.navigateTo,
      label: t("sidebar.feed_actions.navigate_to_list"),
      category,
      run: ({ listId }) => {
        if (!listId) return
        navigateEntry({ listId })
      },
    },
    {
      id: COMMAND_ID.list.copyId,
      label: t("sidebar.feed_actions.copy_list_id"),
      category,
      run: async ({ listId }) => {
        if (!listId) return
        await copyToClipboard(listId)
        toast.success(t("app.copied_to_clipboard", { ns: "common" }), {
          duration: 1000,
        })
      },
    },
  ])
}
