import { Spring } from "@follow/components/constants/spring.js"
import { cn } from "@follow/utils"
import { m } from "motion/react"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { getChatErrorMessage } from "~/modules/ai-chat/utils/error"

interface ErrorMessageProps {
  error: Error | string
  className?: string
}

/**
 * ErrorMessage component for displaying errors in the message list
 * Uses a subtle, message-like appearance with low-key colors
 */
export const ErrorMessage: React.FC<ErrorMessageProps> = ({ error, className }) => {
  const { t } = useTranslation("ai")

  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={Spring.presets.smooth}
      className={cn("group mb-4 flex justify-start", className)}
    >
      <div className="relative flex max-w-full flex-col text-text">
        {/* Main error message bubble - similar to AI message style */}
        <div className="rounded-2xl border border-border bg-fill/50 px-4 py-3">
          <div className="flex flex-col gap-2">
            {/* Header with subtle icon */}
            <div className="flex items-center gap-2">
              <i className="i-mgc-information-cute-re size-4 text-text-tertiary" />
              <span className="text-xs font-medium text-text-secondary">
                {t("chat.error.occurred")}
              </span>
            </div>

            {/* Error message - always visible but subtle */}
            <div className="cursor-text select-text text-sm leading-relaxed text-text-secondary">
              {getChatErrorMessage(error)}
            </div>
          </div>
        </div>
      </div>
    </m.div>
  )
}
