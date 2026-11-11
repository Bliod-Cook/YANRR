import { MotionButtonBase } from "@follow/components/ui/button/index.js"
import { cn } from "@follow/utils/utils"
import { cva } from "class-variance-authority"
import { AnimatePresence, m } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import type { ClipboardContent } from "~/lib/clipboard"
import { copyToClipboard } from "~/lib/clipboard"

const copyButtonVariants = cva(
  ["center pointer-events-auto flex text-xs", "rounded-md p-1.5 duration-200"],
  {
    variants: {
      variant: {
        solid: ["border-accent/5 bg-accent/80 text-white border backdrop-blur"],
        outline: ["text-accent hover:bg-material-ultra-thick"],
        ghost: [
          "border-accent/5 bg-accent/80 text-accent border backdrop-blur",
          "bg-theme-item-active hover:bg-theme-item-hover",
        ],
      },
    },
    defaultVariants: {
      variant: "solid",
    },
  },
)

const iconTransition = { initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 0 } }
const COPIED_DURATION_MS = 2000

export const CopyButton: Component<{
  value: ClipboardContent
  style?: React.CSSProperties
  variant?: "solid" | "outline" | "ghost"
  /** Accessible name, "Copy" by default */
  label?: string
}> = ({ value, className, style, variant, label }) => {
  const { t } = useTranslation("common")
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleCopy = async () => {
    // A failed copy has already been reported, so the check mark must not follow it
    const succeeded = await copyToClipboard(value).then(
      () => true,
      () => false,
    )
    if (!succeeded) return
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), COPIED_DURATION_MS)
  }

  return (
    <MotionButtonBase
      type="button"
      aria-label={label ?? t("words.copy")}
      className={cn(copyButtonVariants({ variant }), className)}
      style={style}
      onClick={handleCopy}
    >
      <AnimatePresence mode="wait">
        {copied ? (
          <m.i key="copied" className="i-mgc-check-filled size-4" {...iconTransition} />
        ) : (
          <m.i key="copy" className="i-mgc-copy-2-cute-re size-4" {...iconTransition} />
        )}
      </AnimatePresence>
    </MotionButtonBase>
  )
}
