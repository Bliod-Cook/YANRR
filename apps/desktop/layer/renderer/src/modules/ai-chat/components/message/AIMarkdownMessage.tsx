import { cn, stopPropagation } from "@follow/utils"
import { memo, useMemo, useRef } from "react"

import { MarkdownAnimateText } from "./animated/AnimatedMarkdown"
import { toMarkdownBlocks } from "./markdown-blocks"

export const AIMarkdownStreamingMessage = memo(
  ({
    text,
    className: classNameProp,
    isStreaming,
  }: {
    text: string
    className?: string
    isStreaming?: boolean
  }) => {
    const className = tw`prose max-w-full dark:prose-invert prose-sm
  prose-h1:text-2xl prose-h2:text-xl prose-h2:mt-2 prose-h3:text-lg prose-h4:text-base prose-h5:text-base prose-h6:text-sm
  prose-li:list-disc prose-li:marker:text-accent prose-hr:border-border prose-hr:mx-8
  w-[calc(var(--ai-chat-message-container-width,65ch))]
  prose-pre:!text-base
  prose-strong:font-bold prose-headings:font-bold
  [&_ol>li]:list-decimal
  `

    // A message that streamed keeps its animated elements once it ends, so they don't remount
    const stableStreamingState = useRef(isStreaming)
    const blocks = useMemo(() => toMarkdownBlocks(text, !!isStreaming), [text, isStreaming])

    return (
      <div onContextMenu={stopPropagation} className={cn(className, classNameProp)}>
        {blocks.map((block, index) => (
          <MarkdownAnimateText
            // Blocks only grow at the end, so the index identifies a block while it streams
            key={index}
            content={block}
            isStreaming={stableStreamingState.current}
          />
        ))}
      </div>
    )
  },
)
