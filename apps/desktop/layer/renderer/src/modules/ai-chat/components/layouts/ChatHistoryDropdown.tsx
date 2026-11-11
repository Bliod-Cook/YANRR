import { ActionButton } from "@follow/components/ui/button/index.js"
import type { ReactNode } from "react"
import { startTransition, useCallback } from "react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu/dropdown-menu"
import { useChatHistory } from "~/modules/ai-chat/hooks/useChatHistory"

import { EmptyState, SessionItem, useChatSessionHandlers } from "./shared"

interface ChatHistoryDropdownProps {
  triggerElement?: ReactNode
  asChild?: boolean
}

export const ChatHistoryDropdown = ({
  triggerElement,
  asChild = true,
}: ChatHistoryDropdownProps) => {
  const { t } = useTranslation("ai")
  const { sessions, loading, loadHistory } = useChatHistory()

  const { handleSessionSelect, handleDeleteSession } = useChatSessionHandlers({ sessions })

  const handleDropdownOpen = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        startTransition(() => {
          loadHistory()
        })
      }
    },
    [loadHistory],
  )

  const defaultTrigger = (
    <ActionButton tooltip={t("chat.history.title")}>
      <i className="i-mgc-history-cute-re size-5 text-text-secondary" />
    </ActionButton>
  )

  return (
    <DropdownMenu onOpenChange={handleDropdownOpen}>
      <DropdownMenuTrigger asChild={asChild}>
        {triggerElement || defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <div className="max-h-80 overflow-y-auto">
          {loading && sessions.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <i className="i-mgc-loading-3-cute-re size-5 animate-spin text-text-secondary" />
            </div>
          ) : sessions.length > 0 ? (
            <>
              <div className="mb-1.5 px-2 py-1">
                <p className="text-xs font-medium text-text-secondary">
                  {t("chat.history.recent")}
                </p>
              </div>
              {sessions.map((session) => (
                <SessionItem
                  key={session.chatId}
                  session={session}
                  onClick={() => handleSessionSelect(session)}
                  onDelete={(e) => handleDeleteSession(session.chatId, e)}
                />
              ))}
            </>
          ) : (
            <EmptyState message={t("chat.history.empty")} />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
