import { Logo } from "@follow/components/icons/logo.jsx"
import { Wordmark } from "@follow/components/icons/wordmark.jsx"
import { cn } from "@follow/utils/utils"
import pkg from "@pkg"

export const PoweredByFooter: Component = ({ className }) => (
  <footer className={cn("center mt-12 flex gap-2", className)}>
    {new Date().getFullYear()}
    <Logo className="size-5" />{" "}
    <a
      href={pkg.homepage}
      className="cursor-pointer font-bold text-orange-500 no-underline"
      target="_blank"
      rel="noreferrer"
    >
      <Wordmark className="text-sm" />
    </a>
  </footer>
)
