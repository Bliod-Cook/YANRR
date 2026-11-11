import "katex/dist/katex.min.css"

import type { SpotlightRule } from "@follow/shared/spotlight"
import katexStyle from "katex/dist/katex.min.css?inline"
import { createElement, Fragment, memo, useImperativeHandle, useMemo, useState } from "react"
import type { JSX } from "react/jsx-runtime"

import { ShadowDOM } from "~/components/common/ShadowDOM"
import { parseHtml } from "~/lib/parse-html"
import { useWrappedElementSize } from "~/providers/wrapped-element-provider"

import { MediaContainerWidthProvider } from "../media/MediaContainerWidthProvider"
import type { MediaInfoRecord } from "../media/MediaInfoRecord"
import { MediaInfoRecordProvider } from "../media/MediaInfoRecordProvider"
import { MarkdownRenderContainerRefContext } from "./context"

export type HTMLProps<A extends keyof JSX.IntrinsicElements = "div"> = {
  children: string | null | undefined
  as: A

  accessory?: React.ReactNode
  noMedia?: boolean
  mediaInfo?: Nullable<MediaInfoRecord>
  coverImageUrl?: string
  baseUrl?: string
} & JSX.IntrinsicElements[A] &
  Partial<{
    renderInlineStyle: boolean
    spotlightRules: SpotlightRule[]
  }>
const HTMLImpl = <A extends keyof JSX.IntrinsicElements = "div">(props: HTMLProps<A>) => {
  const {
    children,
    renderInlineStyle,
    spotlightRules,
    as = "div",
    accessory,
    noMedia,
    mediaInfo,
    coverImageUrl,
    baseUrl,
    ref,
    ...rest
  } = props
  // The options are compared by value: callers pass a new rules array on every render
  const optionsKey = JSON.stringify({ renderInlineStyle, noMedia, spotlightRules })
  const remarkOptions = useMemo(
    () =>
      JSON.parse(optionsKey) as Pick<HTMLProps, "renderInlineStyle" | "noMedia" | "spotlightRules">,
    [optionsKey],
  )

  const [refElement, setRefElement] = useState<HTMLElement | null>(null)
  useImperativeHandle(ref as any, () => refElement)

  const markdownElement = useMemo(
    () =>
      (children || coverImageUrl) &&
      parseHtml(children || "", {
        ...remarkOptions,
        coverImageUrl,
        baseUrl,
      }).toContent(),
    [children, remarkOptions, coverImageUrl, baseUrl],
  )

  const { w: containerWidth } = useWrappedElementSize()

  // The page's own KaTeX stylesheet does not reach into a shadow root
  const needsKatexStyle =
    ShadowDOM.useIsShadowDOM() && typeof children === "string" && children.includes("<math")

  if (!markdownElement) return null
  return (
    <MarkdownRenderContainerRefContext value={refElement}>
      <MediaContainerWidthProvider width={containerWidth}>
        <MediaInfoRecordProvider mediaInfo={mediaInfo}>
          {needsKatexStyle && <style>{katexStyle}</style>}
          {createElement(as, { ...rest, ref: setRefElement }, markdownElement)}
        </MediaInfoRecordProvider>
      </MediaContainerWidthProvider>
      {!!accessory && <Fragment key={optionsKey}>{accessory}</Fragment>}
    </MarkdownRenderContainerRefContext>
  )
}

export const HTML = memo(HTMLImpl)
