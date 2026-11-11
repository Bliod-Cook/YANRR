import type { LexicalRichEditorRef } from "@follow/components/ui/lexical-rich-editor/types.js"
import { atom } from "jotai"
import type { FC, PropsWithChildren } from "react"
import { useEffect, useMemo, useRef } from "react"

import { Focusable } from "~/components/common/Focusable"
import { HotkeyScope } from "~/constants"

import { useAIShortcut } from "../../hooks/useAIShortcut"
import type { AIPanelRefs } from "../../store/AIChatContext"
import {
  AIChatStoreContext,
  AIPanelRefsContext,
  AIRootStateContext,
} from "../../store/AIChatContext"
import { ChatSliceActions } from "../../store/chat-core/chat-actions"
import { createAIChatStore } from "../../store/store"

interface AIChatRootProps extends PropsWithChildren {
  wrapFocusable?: boolean
}

const AIChatRootInner: FC<PropsWithChildren> = ({ children }) => {
  const inputRef = useRef<LexicalRichEditorRef>(null!)
  const refsContext = useMemo<AIPanelRefs>(() => ({ inputRef }), [inputRef])
  useAIShortcut()

  return <AIPanelRefsContext value={refsContext}>{children}</AIPanelRefsContext>
}

export const AIChatRoot: FC<AIChatRootProps> = ({ children, wrapFocusable = true }) => {
  const useAiContextStore = useMemo(() => createAIChatStore(), [])
  const chatActions = useAiContextStore((state) => state.chatActions)

  useEffect(() => ChatSliceActions.activate(chatActions), [chatActions])

  const Element = (
    <AIChatStoreContext value={useAiContextStore}>
      <AIRootStateContext
        value={useMemo(
          () => ({
            isScrolledBeyondThreshold: atom(false),
          }),
          [],
        )}
      >
        <AIChatRootInner>{children}</AIChatRootInner>
      </AIRootStateContext>
    </AIChatStoreContext>
  )

  if (wrapFocusable) {
    return (
      <Focusable scope={HotkeyScope.AIChat} className="size-full">
        {Element}
      </Focusable>
    )
  }
  return Element
}
AIChatRoot.displayName = "AIChatRoot"
