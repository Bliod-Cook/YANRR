import { ScrollArea } from "@follow/components/ui/scroll-area/ScrollArea.js"
import { cn } from "@follow/utils"
import * as React from "react"
import { useRef } from "react"

import { useAutoScroll } from "../../hooks/useAutoScroll"

interface AIReasoningPartProps {
  text: string
  isStreaming?: boolean
  className?: string
}

export const AIReasoningPart: React.FC<AIReasoningPartProps> = React.memo(
  ({ text, className, isStreaming }) => {
    const scrollAreaRef = useRef<HTMLDivElement | null>(null)
    useAutoScroll(scrollAreaRef.current, !!isStreaming)

    if (!text) return null

    return (
      <div className={cn("max-w-full min-w-0 text-left", className)}>
        <div className="w-[calc(var(--ai-chat-message-container-width,65ch))] max-w-full" />
        <div className="text-xs">
          <ScrollArea mask viewportClassName="max-h-[30vh]" ref={scrollAreaRef}>
            <pre className="overflow-x-auto rounded bg-material-medium p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-text-secondary">
              {text}
            </pre>
          </ScrollArea>
        </div>
      </div>
    )
  },
)

AIReasoningPart.displayName = "AIReasoningPart"
