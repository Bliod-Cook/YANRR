import { TextArea } from "@follow/components/ui/input/TextArea.js"
import { useInputComposition, useIsDark } from "@follow/hooks"
import { nextFrame } from "@follow/utils/dom"
import { cn } from "@follow/utils/utils"
import { createPlainShiki } from "plain-shiki"
import { useLayoutEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import css from "shiki/langs/css.mjs"
import githubDark from "shiki/themes/github-dark.mjs"
import githubLight from "shiki/themes/github-light.mjs"
import { useEventCallback } from "usehooks-ts"

import { shiki } from "~/components/ui/code-highlighter/shiki/shared"

shiki.loadLanguageSync(css)
shiki.loadThemeSync(githubDark)
shiki.loadThemeSync(githubLight)

export const CSSEditor: Component<{
  onChange: (value: string) => void
  defaultValue?: string
}> = ({ onChange, className, defaultValue }) => {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  const isDark = useIsDark()

  // Fill the editor once; later theme changes must keep what the user typed.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.textContent = defaultValue ?? ""
    element.focus()
    // Move cursor to the end of the content
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (!ref.current) return
    const { dispose } = createPlainShiki(shiki).mount(ref.current, {
      lang: "css",
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultTheme: isDark ? "dark" : "light",
    })
    return () => {
      dispose()
    }
  }, [isDark])
  const props = useInputComposition<HTMLInputElement>({
    onKeyDown: (e) => {
      if (e.key === "Escape") {
        e.preventDefault()
      }
      if (e.key === "Tab") {
        e.preventDefault()
        const selection = window.getSelection()
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0)
          const tabNode = document.createTextNode("  ")
          range.insertNode(tabNode)
          range.setStartAfter(tabNode)
          range.setEndAfter(tabNode)
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
      nextFrame(() => {
        onChange(ref.current?.textContent ?? "")
      })
    },
  })
  const handleInput = useEventCallback(() => {
    onChange(ref.current?.textContent ?? "")
  })

  const isSupportPlainTextOnly = useIsSupportPlainTextOnly()
  if (!isSupportPlainTextOnly) {
    return (
      <div className="flex size-full flex-col">
        <div className="-mt-2 mb-1 text-center text-sm text-text-tertiary">
          <i className="i-mingcute-warning-line mr-0.5 translate-y-[2px]" />
          {t("editor.css_highlight_unsupported")}
        </div>
        <div className="relative h-0 grow">
          <div className="absolute inset-0">
            <TextArea
              className="font-mono"
              defaultValue={defaultValue}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div
      className={cn(
        "size-full",

        "ring-accent/20 duration-200 focus:border-accent/80 focus:outline-none focus:ring-2",
        "focus:!bg-accent/5",
        "border border-border",
        "placeholder:text-text-tertiary dark:bg-zinc-700/[0.15] dark:text-zinc-200",
        "overflow-auto whitespace-pre hover:border-accent/60",
        className,
      )}
      ref={ref}
      onInput={handleInput}
      contentEditable={isSupportPlainTextOnly ? "plaintext-only" : "true"}
      tabIndex={0}
      {...props}
    />
  )
}
const useIsSupportPlainTextOnly = () => {
  const isSupportPlainTextOnly = useMemo(() => {
    if (typeof document === "undefined") return false

    const div = document.createElement("div")

    try {
      div.contentEditable = "plaintext-only"
    } catch {
      return false
    }

    return div.contentEditable === "plaintext-only"
  }, [])

  return isSupportPlainTextOnly
}
