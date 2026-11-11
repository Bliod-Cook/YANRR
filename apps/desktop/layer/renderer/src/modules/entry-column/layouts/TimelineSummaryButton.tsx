import { ActionButton } from "@follow/components/ui/button/index.js"
import { DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID } from "@follow/shared/settings/defaults"
import { useTranslation } from "react-i18next"

import { useSendAIShortcut } from "~/modules/ai-chat/hooks/useSendAIShortcut"

/** Its own module, so the AI chat it starts is only loaded with the AI feature on */
export const TimelineSummaryButton = () => {
  const { t } = useTranslation()
  const { sendAIShortcut } = useSendAIShortcut()
  return (
    <ActionButton
      tooltip={t("entry_list_header.timeline_summary")}
      onClick={() =>
        void sendAIShortcut({
          shortcutId: DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
          ensureNewChat: true,
        })
      }
    >
      <i className="i-mgc-paint-brush-ai-cute-re text-purple-600 dark:text-purple-400" />
    </ActionButton>
  )
}
