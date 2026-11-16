import { useEntry } from "@follow/store/entry/hooks"
import { cn } from "@follow/utils/utils"

import { useSpotlightSettingKey } from "~/atoms/settings/spotlight"
import { HTML } from "~/components/ui/markdown/HTML"
import { readableContentMaxWidthClassName } from "~/constants/ui"
import { useRenderStyle } from "~/hooks/biz/useRenderStyle"
import { EntryContentUrlProvider } from "~/modules/renderer/content-url"

import { useEntryContent } from "../../../hooks"

interface ContentBodyProps {
  entryId: string
  className?: string
  compact?: boolean
  noMedia?: boolean
}

export const ContentBody: React.FC<ContentBodyProps> = ({
  entryId,
  className,
  compact = false,
  noMedia = false,
}) => {
  const description = useEntry(entryId, (state) => state.description)
  // Translated where the translation is on
  const { content: entryContent } = useEntryContent(entryId)

  const renderStyle = useRenderStyle({
    baseFontSize: compact ? 14 : 16,
    baseLineHeight: compact ? 1.625 : 1.7,
  })
  const spotlightRules = useSpotlightSettingKey("spotlights")

  const content = entryContent || description

  if (!content) return null

  return (
    <EntryContentUrlProvider entryId={entryId}>
      <HTML
        as="div"
        className={cn(
          "prose dark:prose-invert",
          "prose-blockquote:mt-0",
          "cursor-auto select-text",
          readableContentMaxWidthClassName,
          compact ? "text-sm leading-relaxed" : "text-base leading-relaxed",
          className,
        )}
        noMedia={noMedia}
        spotlightRules={spotlightRules}
        style={renderStyle}
      >
        {content}
      </HTML>
    </EntryContentUrlProvider>
  )
}
