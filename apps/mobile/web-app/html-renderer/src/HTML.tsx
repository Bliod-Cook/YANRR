import type { SpotlightRule } from "@follow/shared/spotlight"
import { clsx } from "clsx"
import type { CSSProperties } from "react"
import { useMemo } from "react"

import { WrappedElementProvider } from "./common/WrappedElementProvider"
import { parseHtml } from "./parser"

const articleStyle: CSSProperties = { width: "100%", maxWidth: "100%" }

export type HTMLProps = {
  children: string | null | undefined
  renderInlineStyle?: boolean
  noMedia?: boolean
  spotlightRules?: SpotlightRule[]
  coverImageUrl?: string
  baseUrl?: string
  className?: string
  style?: CSSProperties
}

export const HTML = ({
  children,
  renderInlineStyle,
  noMedia,
  spotlightRules,
  coverImageUrl,
  baseUrl,
  className,
  style,
}: HTMLProps) => {
  const content = useMemo(() => {
    if (!children && (!coverImageUrl || noMedia)) return null

    return parseHtml(children ?? "", {
      renderInlineStyle,
      noMedia,
      spotlightRules,
      coverImageUrl,
      baseUrl,
    }).toContent()
  }, [children, renderInlineStyle, noMedia, spotlightRules, coverImageUrl, baseUrl])

  if (!content) return <div className="h-px" />
  return (
    <WrappedElementProvider>
      <article
        style={{ ...articleStyle, ...style }}
        className={clsx(
          "prose mx-auto max-w-none pb-8 [text-autospace:normal]",
          "dark:prose-invert",
          className,
        )}
      >
        {content}
      </article>
    </WrappedElementProvider>
  )
}
