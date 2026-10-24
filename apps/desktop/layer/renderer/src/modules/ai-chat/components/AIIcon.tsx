import { cn } from "@follow/utils"

export const AIIcon = ({ className }: { className?: string }) => (
  <i
    className={cn("i-mingcute-ai-line mx-auto block size-16 text-accent", className)}
    aria-hidden
  />
)
