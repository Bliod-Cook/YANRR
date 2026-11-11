import { AIChatPanelStyle, useAIChatPanelStyle, useAIPanelVisibility } from "~/atoms/settings/ai"
import { useOptionalChatHasMessages } from "~/modules/ai-chat/store/hooks"

import { AISummary } from "../AISummary"

/** Its own module, so the chat store is only loaded with the AI feature on */
export const ArticleAISummary: React.FC<{ entryId: string }> = ({ entryId }) => {
  const aiChatPanelStyle = useAIChatPanelStyle()
  const isAIPanelVisible = useAIPanelVisibility()
  const chatHasMessages = useOptionalChatHasMessages()

  // The fixed panel shows the summary on the welcome screen of an empty chat instead
  const shouldShowAISummary =
    aiChatPanelStyle === AIChatPanelStyle.Floating || !isAIPanelVisible || chatHasMessages

  return shouldShowAISummary ? <AISummary entryId={entryId} /> : null
}
