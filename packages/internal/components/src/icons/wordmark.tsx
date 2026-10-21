import { cn } from "@follow/utils/utils"
import type * as React from "react"

export const Wordmark = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("font-bold leading-none tracking-tight", className)} {...props}>
    Yanrr
  </span>
)
