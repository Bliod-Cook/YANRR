import { useTranslation } from "react-i18next"

import { RelativeDay } from "~/components/ui/datetime"
import { DropdownMenuItem } from "~/components/ui/dropdown-menu/dropdown-menu"
import type { ChatSession } from "~/modules/ai-chat/types/ChatSession"

// Types
export interface SessionItemProps {
  session: ChatSession
  onClick?: () => void
  onDelete?: (e: React.MouseEvent) => void
}

export interface EmptyStateProps {
  message: string
}

export const SessionItem = ({ session, onClick, onDelete }: SessionItemProps) => {
  const { t } = useTranslation("ai")
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={`group relative ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="ml-1 flex min-w-0 flex-1 justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="mb-0.5 truncate font-medium">{session.title || t("chat.untitled")}</p>
        </div>
        <div className="relative flex min-w-0 items-center">
          <p className="ml-2 shrink-0 truncate text-xs text-text-secondary">
            <RelativeDay plain date={new Date(session.updatedAt)} />
          </p>
          {onDelete && (
            <button
              type="button"
              aria-label={t("delete_chat")}
              onClick={onDelete}
              className="absolute inset-y-0 right-0 flex items-center rounded-md bg-accent px-2 py-1 text-white opacity-0 group-data-[highlighted]:text-white group-data-[highlighted]:opacity-100"
            >
              <i className="i-mgc-delete-2-cute-re size-4" />
            </button>
          )}
        </div>
      </div>
    </DropdownMenuItem>
  )
}

export const EmptyState = ({ message }: EmptyStateProps) => {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <i className="i-mgc-time-cute-re mb-2 block size-8 text-text-secondary" />
      <p className="text-sm text-text-secondary">{message}</p>
    </div>
  )
}
