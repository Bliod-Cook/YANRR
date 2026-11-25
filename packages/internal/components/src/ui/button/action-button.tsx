import { stopPropagation } from "@follow/utils/dom"
import { cn } from "@follow/utils/utils"
import * as React from "react"
import { useState } from "react"

import { KbdCombined } from "../kbd/Kbd"
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from "../tooltip"

export interface ActionButtonProps {
  icon?: React.ReactNode | ((props: { isActive?: boolean; className: string }) => React.ReactNode)
  tooltip?: React.ReactNode
  tooltipDescription?: React.ReactNode
  tooltipSide?: "top" | "bottom"
  active?: boolean
  disabled?: boolean
  clickableDisabled?: boolean
  /** Shown in the tooltip only: the feature that owns the key binds it */
  shortcut?: string
  enableHoverableContent?: boolean
  size?: "xs" | "sm" | "base" | "lg"
  id?: string
  /**
   * Use motion effects to prompt and guide users to pay attention or click this button
   */
  highlightMotion?: boolean
}

const actionButtonStyleVariant = {
  size: {
    lg: tw`text-xl size-10`,
    base: tw`text-xl size-8`,
    sm: tw`text-lg size-7`,
    xs: tw`text-base size-[1.3rem]`,
  },
}

export const ActionButton = ({
  ref,
  icon,
  id,
  tooltip,
  tooltipDescription,
  className,
  tooltipSide,
  highlightMotion,
  children,
  active,
  shortcut,
  disabled,
  clickableDisabled,
  enableHoverableContent,
  size = "base",
  onClick,
  ...rest
}: ComponentType<ActionButtonProps> &
  React.HTMLAttributes<HTMLButtonElement> & {
    ref?: React.Ref<HTMLButtonElement | null>
  }) => {
  const [shouldHighlightMotion, setShouldHighlightMotion] = useState(highlightMotion)
  React.useEffect(() => {
    setShouldHighlightMotion(highlightMotion)
  }, [highlightMotion])

  const [loading, setLoading] = useState(false)

  const Trigger = (
    <button
      ref={ref}
      // @see https://github.com/radix-ui/primitives/issues/2248#issuecomment-2147056904
      onFocusCapture={stopPropagation}
      className={cn(
        "pointer-events-auto inline-flex items-center justify-center no-drag-region",
        active && typeof icon !== "function" && "bg-zinc-500/15 hover:bg-zinc-500/20",
        "rounded-md duration-200 hover:bg-theme-item-hover data-[state=open]:bg-theme-item-active",
        "focus-visible:ring-2 focus-visible:ring-border focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        clickableDisabled && "cursor-not-allowed opacity-50",
        shouldHighlightMotion &&
          "relative after:absolute after:inset-0 after:animate-[radialPulse_3s_ease-in-out_infinite] after:rounded-md after:bg-center after:bg-no-repeat after:content-['']",
        actionButtonStyleVariant.size[size],
        className,
      )}
      style={{
        ...rest.style,
        ...(shouldHighlightMotion
          ? ({
              "--tw-accent-opacity": "0.3",
              "--highlight-color": "hsl(var(--fo-a) / var(--tw-accent-opacity))",
            } as React.CSSProperties)
          : {}),
      }}
      type="button"
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={disabled || clickableDisabled || undefined}
      onClick={
        onClick
          ? async (e) => {
              setShouldHighlightMotion(false)
              if (loading) return
              const result = onClick(e) as void | Promise<void>
              // Only an async handler shows the loading state
              if (!(result instanceof Promise)) return
              setLoading(true)
              try {
                await result
              } finally {
                setLoading(false)
              }
            }
          : void 0
      }
      id={id}
      {...rest}
    >
      {loading ? (
        <i className="i-mgc-loading-3-cute-re animate-spin" />
      ) : typeof icon === "function" ? (
        React.createElement(icon, {
          className: "size-4 grayscale text-current",

          isActive: active,
        })
      ) : (
        icon
      )}

      {children}
    </button>
  )

  if (!tooltip) return Trigger

  return (
    <Tooltip disableHoverableContent={!enableHoverableContent}>
      <TooltipTrigger aria-label={typeof tooltip === "string" ? tooltip : undefined} asChild>
        {Trigger}
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent className="max-w-[300px] flex-col gap-1" side={tooltipSide ?? "bottom"}>
          <div className="flex items-center gap-1">
            {tooltip}
            {!!shortcut && (
              <div className="ml-1">
                <KbdCombined className="text-text">{shortcut}</KbdCombined>
              </div>
            )}
          </div>
          {tooltipDescription ? (
            <div className="text-body text-text-secondary">{tooltipDescription}</div>
          ) : null}
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  )
}
