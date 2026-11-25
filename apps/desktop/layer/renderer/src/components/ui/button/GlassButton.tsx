import { Spring } from "@follow/components/constants/spring.js"
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@follow/components/ui/tooltip/index.js"
import { cn } from "@follow/utils/utils"
import { cva } from "class-variance-authority"
import { m } from "motion/react"
import type { FC, ReactNode } from "react"

export interface GlassButtonProps {
  /**
   * Shown as a tooltip and used as the accessible name, since the button only holds an icon
   */
  description?: string
  onClick?: () => void
  /**
   * Ignores clicks and is announced as disabled, but stays focusable and keeps its tooltip
   */
  disabled?: boolean
  className?: string
  testId?: string
  children: ReactNode
  /**
   * Size variant
   */
  size?: "sm" | "md" | "lg"
  /**
   * Color theme
   */
  theme?: "light" | "dark" | "auto"
}

const glassButtonVariants = cva(
  [
    // Base styles - perfect 1:1 circle
    "pointer-events-auto relative flex items-center justify-center rounded-full",
    "border shadow-sm transition-all duration-300 ease-out no-drag-region hover:shadow-md",
  ],
  {
    variants: {
      size: {
        sm: "size-8 text-sm",
        md: "size-10 text-lg",
        lg: "size-12 text-xl",
      },
      theme: {
        light: [
          "text-gray-700 hover:text-gray-900",
          "bg-white/80 hover:bg-white/90",
          "border-gray/20 hover:border-gray/30",
          // Subtle shadow color for clearer hover feedback
          "shadow-gray/10 hover:shadow-gray/25",
        ],
        dark: [
          "text-white hover:text-white",
          "bg-fill-secondary hover:bg-fill-tertiary",
          "border-gray/20 hover:border-gray/30",
          "shadow-black/10 hover:shadow-black/25",
        ],
        auto: [
          "text-text hover:text-text-vibrant",
          "bg-white/80 hover:bg-white/90 dark:bg-fill-secondary dark:hover:bg-fill-tertiary",
          "border-gray/20 hover:border-gray/30",
          "shadow-gray/10 hover:shadow-gray/25 dark:shadow-black/10 dark:hover:shadow-black/25",
        ],
      },
    },
    defaultVariants: {
      size: "md",
      theme: "auto",
    },
  },
)

export const GlassButton: FC<GlassButtonProps> = ({
  description,
  onClick,
  disabled,
  className,
  testId,
  children,
  size = "md",
  theme = "auto",
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <m.button
          data-testid={testId}
          type="button"
          aria-label={description}
          aria-disabled={disabled || undefined}
          onClick={(e) => {
            e.stopPropagation()
            if (disabled) return
            onClick?.()
          }}
          className={cn(glassButtonVariants({ size, theme }), className)}
          initial={{ scale: 1 }}
          whileTap={{ scale: 0.95 }}
          transition={Spring.presets.snappy}
        >
          <div className="relative z-10 center flex">{children}</div>
        </m.button>
      </TooltipTrigger>
      {description && (
        <TooltipPortal>
          <TooltipContent>{description}</TooltipContent>
        </TooltipPortal>
      )}
    </Tooltip>
  )
}
