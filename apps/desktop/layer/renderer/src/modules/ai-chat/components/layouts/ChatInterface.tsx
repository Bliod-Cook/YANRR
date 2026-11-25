import { useFocusable } from "@follow/components/common/Focusable/hooks.js"
import type { LexicalRichEditorRef } from "@follow/components/ui/lexical-rich-editor/types.js"
import { usePrefetchSummary } from "@follow/store/summary/hooks"
import { checkIsEditableElement, nextFrame } from "@follow/utils"
import type { EditorState } from "lexical"
import type { RefObject } from "react"
import { use, useEffect, useMemo, useRef, useState } from "react"
import { useEventCallback, useEventListener } from "usehooks-ts"

import { useAISettingKey } from "~/atoms/settings/ai"
import { useActionLanguage } from "~/atoms/settings/general"
import { ErrorBoundary } from "~/components/common/ErrorBoundary"
import { useRequireLogin } from "~/hooks/common/useRequireLogin"
import { useAutoScroll } from "~/modules/ai-chat/hooks/useAutoScroll"
import { useMainEntryId } from "~/modules/ai-chat/hooks/useMainEntryId"
import {
  useBlockActions,
  useChatActions,
  useChatError,
  useChatStatus,
  useCurrentChatId,
  useHasMessages,
  useLastUserMessage,
} from "~/modules/ai-chat/store/hooks"

import { useAttachScrollBeyond } from "../../hooks/useAttachScrollBeyond"
import { AIPanelRefsContext } from "../../store/AIChatContext"
import type { BizUIMessage } from "../../store/types"
import { createUserMessage } from "../../store/user-message"
import { GlobalFileDropZone } from "../file/GlobalFileDropZone"
import { AIErrorFallback } from "./AIErrorFallback"
import { ChatBottomPanel } from "./ChatBottomPanel"
import { ChatMessageContainer } from "./ChatMessageContainer"

const draftMessages = new Map<string, EditorState>()
const ChatInterfaceContent = ({ centerInputOnEmpty, visualOffsetY }: ChatInterfaceProps) => {
  const hasMessages = useHasMessages()
  const status = useChatStatus()
  const chatActions = useChatActions()
  const error = useChatError()
  // Only the last user message is needed, so streamed chunks don't re-render the whole chat
  const lastUserMessageInChat = useLastUserMessage()
  const { ensureLogin } = useRequireLogin()

  const isFocusWithin = useFocusable()

  const aiPanelRefs = use(AIPanelRefsContext)

  useChatInputFocusHandler(isFocusWithin, aiPanelRefs.inputRef)
  useLogChatError(error)

  const currentChatId = useCurrentChatId()
  const mainEntryId = useMainEntryId()
  const actionLanguage = useActionLanguage()

  usePrefetchSummary({
    entryId: mainEntryId || "",
    target: "content",
    actionLanguage,
    enabled: !!mainEntryId && !hasMessages,
  })

  const {
    scrollAreaRef,
    setScrollAreaRef,
    messageContainerMinHeight,
    messagesContentRef,
    scrollContainerParentRef,
    captureContentHeightBeforeSend,
    handleScrollPositioning,
    updateContentHeightSnapshot,
  } = useChatScroller(currentChatId)

  const autoScrollWhenStreaming = useAISettingKey("autoScrollWhenStreaming")

  const { shouldShowInterruptionNotice, lastUserMessage } = useInterruptionNotice(
    lastUserMessageInChat,
    status,
  )

  const { resetScrollState } = useAutoScroll(
    scrollAreaRef,
    autoScrollWhenStreaming && status === "streaming",
  )

  const blockActions = useBlockActions()

  const handleSendMessage = useEventCallback((message: string | EditorState) => {
    if (!ensureLogin()) {
      return
    }
    resetScrollState()

    captureContentHeightBeforeSend()
    void chatActions.sendMessage(createUserMessage(message, blockActions.takeMessageContext()))

    // Clear draft message after sending
    clearDraft()

    nextFrame(() => {
      // Calculate and adjust scroll positioning immediately
      handleScrollPositioning()
    })
  })

  // An interrupted message is asked again as it was sent
  const handleRetryLastMessage = useEventCallback(() => {
    if (!ensureLogin()) {
      return
    }
    if (!lastUserMessage) {
      return
    }

    resetScrollState()
    captureContentHeightBeforeSend()

    void chatActions.regenerate({ messageId: lastUserMessage.id })

    nextFrame(() => {
      handleScrollPositioning()
    })
  })

  const { handleDraftChange, initialDraft, clearDraft } = useChatDraft(currentChatId)

  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(0)

  useEffect(() => {
    if (status === "submitted") {
      resetScrollState()
    }

    // When AI response is complete, update the reference height but keep the container height unchanged
    // This avoids CLS while ensuring next calculation is based on actual content
    if (status === "ready" && scrollAreaRef && messagesContentRef.current) {
      // Update the reference to actual content height for next calculation (use messages container)
      updateContentHeightSnapshot()
      // Keep the current minHeight unchanged to avoid CLS
    }
  }, [status, resetScrollState, scrollAreaRef, updateContentHeightSnapshot, messagesContentRef])

  const { handleScroll } = useAttachScrollBeyond()

  return (
    <div className="@container flex size-full flex-col">
      <GlobalFileDropZone className="@container flex size-full flex-col">
        <div className="flex min-h-0 flex-1 flex-col" ref={scrollContainerParentRef}>
          <ChatMessageContainer
            currentChatId={currentChatId}
            hasMessages={hasMessages}
            bottomPanelHeight={bottomPanelHeight}
            messageContainerMinHeight={messageContainerMinHeight}
            messagesContentRef={messagesContentRef}
            onScroll={handleScroll}
            setScrollAreaRef={setScrollAreaRef}
            status={status}
            centerInputOnEmpty={centerInputOnEmpty}
            onScrollToBottom={resetScrollState}
          />
        </div>

        <ChatBottomPanel
          hasMessages={hasMessages}
          centerInputOnEmpty={centerInputOnEmpty}
          visualOffsetY={visualOffsetY}
          shouldShowInterruptionNotice={shouldShowInterruptionNotice}
          onRetryLastMessage={handleRetryLastMessage}
          onSendMessage={handleSendMessage}
          initialDraftState={initialDraft}
          onDraftChange={handleDraftChange}
          onHeightChange={setBottomPanelHeight}
        />
      </GlobalFileDropZone>
    </div>
  )
}

interface ChatInterfaceProps {
  centerInputOnEmpty?: boolean
  visualOffsetY?: string | number
}
export const ChatInterface = (props: ChatInterfaceProps) => (
  <ErrorBoundary fallback={AIErrorFallback}>
    <ChatInterfaceContent {...props} />
  </ErrorBoundary>
)

const useChatInputFocusHandler = (
  isFocusWithin: boolean,
  inputRef?: RefObject<LexicalRichEditorRef>,
) => {
  useEventListener("keydown", (event) => {
    if (!isFocusWithin) {
      return
    }
    const currentActiveElement = document.activeElement

    if (checkIsEditableElement(currentActiveElement as HTMLElement)) {
      return
    }

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      return
    }

    // Only a printable character starts typing. Tab, Enter, Space, the arrow and paging keys
    // keep working on the focused button or the message list.
    if (event.key.length !== 1 || event.key === " " || event.altKey || event.isComposing) {
      return
    }

    inputRef?.current?.focus()
  })
}

const useLogChatError = (error: unknown) => {
  useEffect(() => {
    if (error) {
      console.error("AIChat Error:", error)
    }
  }, [error])
}

const useInterruptionNotice = (
  lastUserMessage: BizUIMessage | null,
  status: ReturnType<typeof useChatStatus>,
) => {
  return useMemo(() => {
    const shouldShow =
      !!lastUserMessage && status !== "streaming" && status !== "error" && status !== "submitted"

    return {
      shouldShowInterruptionNotice: shouldShow,
      lastUserMessage: shouldShow ? lastUserMessage : null,
    }
  }, [lastUserMessage, status])
}

const useChatDraft = (currentChatId?: string | null) => {
  const handleDraftChange = useEventCallback((editorState: EditorState) => {
    if (currentChatId) {
      draftMessages.set(currentChatId, editorState)
    }
  })

  const clearDraft = useEventCallback(() => {
    if (currentChatId) {
      draftMessages.delete(currentChatId)
    }
  })

  const initialDraft = currentChatId ? draftMessages.get(currentChatId) : undefined

  return {
    handleDraftChange,
    initialDraft,
    clearDraft,
  }
}

const useChatScroller = (currentChatId?: string | null) => {
  const [scrollAreaRef, setScrollAreaRef] = useState<HTMLDivElement | null>(null)
  const [messageContainerMinHeight, setMessageContainerMinHeight] = useState<number | undefined>()
  const messagesContentRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerParentRef = useRef<HTMLDivElement | null>(null)
  const scrollHeightBeforeSendingRef = useRef<number>(0)
  const previousMinHeightRef = useRef<number>(0)

  useEffect(() => {
    setMessageContainerMinHeight(undefined)
    previousMinHeightRef.current = 0
  }, [currentChatId])

  const captureContentHeightBeforeSend = useEventCallback(() => {
    scrollHeightBeforeSendingRef.current = messagesContentRef.current?.scrollHeight ?? 0
  })

  const handleScrollPositioning = useEventCallback(() => {
    const $scrollContainerParent = scrollContainerParentRef.current
    if (!scrollAreaRef || !$scrollContainerParent) return

    const parentClientHeight = $scrollContainerParent.clientHeight
    const currentScrollHeight = scrollHeightBeforeSendingRef.current
    const baseHeight = Math.max(previousMinHeightRef.current, currentScrollHeight)
    const newMinHeight = baseHeight + parentClientHeight - 250

    setMessageContainerMinHeight(newMinHeight)

    nextFrame(() => {
      scrollAreaRef.scrollTo({
        top: scrollAreaRef.scrollHeight,
        behavior: "instant",
      })
    })
  })

  const updateContentHeightSnapshot = useEventCallback(() => {
    if (scrollAreaRef && messagesContentRef.current) {
      previousMinHeightRef.current = messagesContentRef.current.scrollHeight
    }
  })

  return {
    scrollAreaRef,
    setScrollAreaRef,
    messageContainerMinHeight,
    messagesContentRef,
    scrollContainerParentRef,
    captureContentHeightBeforeSend,
    handleScrollPositioning,
    updateContentHeightSnapshot,
  }
}
