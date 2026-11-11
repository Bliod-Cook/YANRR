import { cn } from "@follow/utils/utils"

import { GlassButton } from "~/components/ui/button/GlassButton"

import { useSubViewActions } from "./hooks"

export const SubViewHeaderActions = ({ isHeaderElevated }: { isHeaderElevated: boolean }) => {
  const actions = useSubViewActions()

  if (actions.length === 0) return null

  return (
    <div
      className={cn(
        "-mt-2 inline-flex items-center gap-1.5 rounded-full bg-fill p-2 backdrop-blur-background duration-200",
        "has-[:nth-child(1)]:bg-transparent",
        !isHeaderElevated && actions.length > 1 ? "bg-material-ultra-thin" : "bg-material-medium",
      )}
    >
      {actions.map(({ id, icon, label, onClick, disabled, loading }) => (
        <GlassButton
          key={id}
          description={label}
          disabled={disabled || loading}
          onClick={onClick}
          className={cn(disabled || loading ? "cursor-not-allowed opacity-50" : "")}
          size="md"
          theme="auto"
        >
          <i className={cn(loading ? "i-mgc-loading-3-cute-re animate-spin" : icon)} />
        </GlassButton>
      ))}
    </div>
  )
}
