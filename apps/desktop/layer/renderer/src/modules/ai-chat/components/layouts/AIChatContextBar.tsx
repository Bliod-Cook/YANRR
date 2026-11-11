import { Popover, PopoverContent, PopoverTrigger } from "@follow/components/ui/popover/index.jsx"
import { cn } from "@follow/utils/utils"
import { memo, useCallback, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"

import { useDisplayBlocks } from "~/modules/ai-chat/hooks/useDisplayBlocks"
import { useFileUploadWithDefaults } from "~/modules/ai-chat/hooks/useFileUpload"
import { useRouteContext } from "~/modules/ai-chat/hooks/useRouteContext"
import { useAIChatStore } from "~/modules/ai-chat/store/AIChatContext"
import type { AIChatContextBlock } from "~/modules/ai-chat/store/types"
import { SUPPORTED_MIME_ACCEPT } from "~/modules/ai-chat/utils/file-validation"

import { useBlockActions } from "../../store/hooks"
import { CombinedContextBlock, ContextBlock } from "../context-bar/blocks"
import { MentionButton } from "../context-bar/MentionButton"

// Maximum number of context blocks to show before collapsing into "more" popover
const MAX_VISIBLE_BLOCKS = 4

export const AIChatContextBar: Component = memo(({ className }) => {
  const { t } = useTranslation("ai")
  const attachmentBlocks = useAIChatStore()((s) => s.blocks)
  const excludedContextKey = useAIChatStore()((s) => s.excludedContextKey)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { handleFileInputChange } = useFileUploadWithDefaults()

  const handleAttachFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const { setContextExcluded, removeFileAttachment } = useBlockActions()
  const routeContext = useRouteContext()
  const isRouteContextExcluded = !!routeContext && routeContext.key === excludedContextKey

  const blocks = useMemo<AIChatContextBlock[]>(() => {
    const contextBlocks =
      routeContext?.blocks.map((block) =>
        isRouteContextExcluded ? { ...block, disabled: true } : block,
      ) ?? []
    return [...contextBlocks, ...attachmentBlocks]
  }, [attachmentBlocks, isRouteContextExcluded, routeContext])

  const excludeRouteContext = useCallback(
    () => routeContext && setContextExcluded(routeContext.key, true),
    [routeContext, setContextExcluded],
  )
  const includeRouteContext = useCallback(
    () => routeContext && setContextExcluded(routeContext.key, false),
    [routeContext, setContextExcluded],
  )

  const displayBlocks = useDisplayBlocks(blocks)

  // Split blocks into visible and hidden based on MAX_VISIBLE_BLOCKS
  const { visibleBlocks, hiddenBlocks } = useMemo(() => {
    if (displayBlocks.length <= MAX_VISIBLE_BLOCKS) {
      return { visibleBlocks: displayBlocks, hiddenBlocks: [] }
    }
    return {
      visibleBlocks: displayBlocks.slice(0, MAX_VISIBLE_BLOCKS),
      hiddenBlocks: displayBlocks.slice(MAX_VISIBLE_BLOCKS),
    }
  }, [displayBlocks])

  const renderBlock = useCallback(
    (item: (typeof displayBlocks)[number]) => {
      if (item.kind === "combined") {
        return (
          <CombinedContextBlock
            key={`combined-${item.viewBlock?.id}-${item.feedBlock?.id}-${item.unreadOnlyBlock?.id}`}
            viewBlock={item.viewBlock}
            feedBlock={item.feedBlock}
            unreadOnlyBlock={item.unreadOnlyBlock}
            onRemove={excludeRouteContext}
            onRestore={includeRouteContext}
          />
        )
      }

      const { block } = item
      return block.type === "fileAttachment" ? (
        <ContextBlock
          key={block.id}
          block={block}
          onRemove={() => removeFileAttachment(block.attachment.id)}
        />
      ) : (
        <ContextBlock
          key={block.id}
          block={block}
          onRemove={excludeRouteContext}
          onRestore={includeRouteContext}
        />
      )
    },
    [excludeRouteContext, includeRouteContext, removeFileAttachment],
  )

  return (
    <div className={cn("flex items-center gap-2 px-4 py-3", className)}>
      <MentionButton />

      {/* File Upload Button */}
      <button
        type="button"
        onClick={handleAttachFile}
        className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-material-medium text-text-secondary transition-colors hover:bg-material-thin hover:text-text-secondary"
        title={t("chat.context.upload_files")}
      >
        <i className="i-mgc-attachment-cute-re size-3.5" />
      </button>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={SUPPORTED_MIME_ACCEPT}
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Visible Context Blocks */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {visibleBlocks.map((item) => (
          <div
            key={
              item.kind === "combined"
                ? `combined-${item.viewBlock?.id}-${item.feedBlock?.id}-${item.unreadOnlyBlock?.id}`
                : item.block.id
            }
            className="max-w-[min(240px,100%)] shrink-0"
          >
            {renderBlock(item)}
          </div>
        ))}

        {/* More Button with Popover */}
        {hiddenBlocks.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-material-medium px-2.5 text-xs text-text-secondary transition-colors hover:bg-fill-secondary hover:text-text"
              >
                <i className="i-mgc-more-1-cute-re size-3.5" />
                <span>+{hiddenBlocks.length}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="start">
              <div className="flex flex-col gap-2">
                <div className="mb-1 text-xs font-medium text-text-secondary">
                  {t("chat.context.additional")}
                </div>
                {hiddenBlocks.map((item) => renderBlock(item))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
})
AIChatContextBar.displayName = "AIChatContextBar"
