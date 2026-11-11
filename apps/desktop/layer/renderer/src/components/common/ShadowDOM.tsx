import { useIsDark } from "@follow/hooks"
import { getAccentColorValue } from "@follow/shared/settings/constants"
import { hexToHslString } from "@follow/utils"
import { nanoid } from "nanoid"
import type { FC, PropsWithChildren, ReactNode } from "react"
import { createContext, createElement, use, useLayoutEffect, useMemo, useState } from "react"
import root from "react-shadow"

import { useUISettingKeys } from "~/atoms/settings/ui"
import { useReduceMotion } from "~/hooks/biz/useReduceMotion"
import { buildAppFontFamily } from "~/lib/font-family"

const ShadowDOMContext = createContext(false)

const weakMapElementKey = new WeakMap<HTMLStyleElement | HTMLLinkElement, string>()
const cloneStylesElement = () => {
  const $styles = document.head.querySelectorAll("style").values()
  const reactNodes = [] as ReactNode[]

  for (const $style of $styles) {
    let key = weakMapElementKey.get($style)

    if (!key) {
      key = nanoid(8)

      weakMapElementKey.set($style, key)
    }

    reactNodes.push(createElement("style", { key }, $style.textContent))
  }

  // Once per linked sheet, independent of the inline styles above
  for (const style of getLinkedStaticStyleSheets()) {
    let key = weakMapElementKey.get(style.ref)
    if (!key) {
      key = nanoid(8)
      weakMapElementKey.set(style.ref, key)
    }

    reactNodes.push(createElement("style", { key, "data-href": style.ref.href }, style.cssText))
  }

  return reactNodes
}
export const ShadowDOM: FC<
  PropsWithChildren<React.HTMLProps<HTMLElement>> & {
    injectHostStyles?: boolean
  }
> & {
  useIsShadowDOM: () => boolean
} = (props) => {
  const { injectHostStyles = true, ...rest } = props

  const [stylesElements, setStylesElements] = useState<ReactNode[]>(() =>
    injectHostStyles ? cloneStylesElement() : [],
  )

  useLayoutEffect(() => {
    if (!injectHostStyles) return
    const mutationObserver = new MutationObserver(() => {
      setStylesElements(cloneStylesElement())
    })
    mutationObserver.observe(document.head, {
      childList: true,
      subtree: true,
    })

    return () => {
      mutationObserver.disconnect()
    }
  }, [injectHostStyles])

  const dark = useIsDark()

  const reduceMotion = useReduceMotion()
  const [uiFont, usePointerCursor, accentColor] = useUISettingKeys([
    "uiFontFamily",
    "usePointerCursor",
    "accentColor",
  ])

  return (
    // Content styles can restyle the host through :host, even with !important, but not this
    // wrapper: its paint containment keeps everything, fixed positioning included, in this box.
    // The clip margin leaves room for the heading anchors beside the text.
    <div className="contain-paint [overflow-clip-margin:3rem]">
      {/* @ts-expect-error */}
      <root.div {...rest}>
        <ShadowDOMContext value={true}>
          <div
            style={useMemo(
              () => ({
                fontFamily: buildAppFontFamily(uiFont),
                "--pointer": usePointerCursor ? "pointer" : "default",
                "--fo-a": hexToHslString(getAccentColorValue(accentColor)[dark ? "dark" : "light"]),
              }),
              [uiFont, usePointerCursor, accentColor, dark],
            )}
            id="shadow-html"
            data-motion-reduce={reduceMotion}
            data-theme={dark ? "dark" : "light"}
            className="font-theme"
          >
            {injectHostStyles ? stylesElements : null}
            {props.children}
          </div>
        </ShadowDOMContext>
      </root.div>
    </div>
  )
}

ShadowDOM.useIsShadowDOM = () => use(ShadowDOMContext)

const cacheCssTextMap = {} as Record<string, string>

function getLinkedStaticStyleSheets() {
  const $links = document.head
    .querySelectorAll("link[rel=stylesheet]")
    .values() as unknown as HTMLLinkElement[]

  const styleSheetMap = new WeakMap<Element | ProcessingInstruction, CSSStyleSheet>()

  const cssArray = [] as { cssText: string; ref: HTMLLinkElement }[]

  for (const sheet of document.styleSheets) {
    if (!sheet.href) continue
    if (!sheet.ownerNode) continue
    styleSheetMap.set(sheet.ownerNode, sheet)
  }

  for (const $link of $links) {
    const sheet = styleSheetMap.get($link)
    if (!sheet) continue
    if (!sheet.href) continue
    const hasCache = cacheCssTextMap[sheet.href]
    if (!hasCache) {
      if (!sheet.href) continue
      try {
        const rules = sheet.cssRules || sheet.rules
        let cssText = ""
        for (const rule of rules) {
          cssText += rule.cssText
        }
        cacheCssTextMap[sheet.href] = cssText
      } catch (err) {
        console.error("Failed to get cssText for", sheet.href, err)
      }
    }

    cssArray.push({
      cssText: cacheCssTextMap[sheet.href]!,
      ref: $link,
    })
  }

  return cssArray
}
