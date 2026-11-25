import { Logo } from "@follow/components/icons/logo.jsx"
import { Wordmark } from "@follow/components/icons/wordmark.jsx"
import { cn } from "@follow/utils/utils"

export const PoweredByFooter: Component = ({ className }) => (
  <footer className={cn("mt-12 center flex gap-2", className)}>
    {new Date().getFullYear()}
    <Logo className="size-5" />
    <Wordmark className="text-sm" />
  </footer>
)
