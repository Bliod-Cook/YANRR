import { cn } from "@follow/utils"
import { Fragment, memo, useMemo } from "react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu/dropdown-menu"

import { useAIModel } from "../../hooks/useAIModel"

interface AIModelIndicatorProps {
  className?: string
  onModelChange?: (model: string) => void
}

type ProviderType = "openai" | "google" | "auto" | "deepseek" | "anthropic" | "moonshotai"

const providerIcons: Record<ProviderType, string> = {
  auto: "i-mingcute-ai-line",
  openai: "i-simple-icons-openai",
  google: "i-simple-icons-googlegemini",
  anthropic: "i-simple-icons-claude",
  deepseek: "i-simple-icons-deepseek",
  moonshotai: "i-simple-icons-moonshotai",
}

const parseModelString = (modelString: string) => {
  if (!modelString || !modelString.includes("/") || modelString === "auto") {
    return { provider: "auto" as ProviderType, modelName: modelString || "Unknown" }
  }

  const [provider, ...modelParts] = modelString.split("/")
  const modelName = modelParts.join("/")

  return {
    provider: (provider as ProviderType) || "auto",
    modelName: modelName || "Unknown",
  }
}

export const AIModelIndicator = memo(({ className, onModelChange }: AIModelIndicatorProps) => {
  const { t } = useTranslation("ai")
  const { data, changeModel } = useAIModel()
  const { defaultModel, availableModels = [], currentModel, availableModelsMenu = [] } = data || {}

  const { provider, modelName } = useMemo(() => {
    return parseModelString(currentModel || defaultModel || "")
  }, [currentModel, defaultModel])

  const selectedMenuItem = useMemo(() => {
    return availableModelsMenu.find((item) => item.value === currentModel)
  }, [availableModelsMenu, currentModel])

  const iconClass = providerIcons[provider] || providerIcons.auto
  const hasMultipleModels = availableModels && availableModels.length > 1
  const modelLabel = selectedMenuItem?.label || modelName

  const modelContentClassName = cn(
    "inline-flex shrink-0 items-center rounded-xl border font-medium backdrop-blur-sm transition-colors",
    hasMultipleModels ? "cursor-button hover:bg-material-medium" : "hover:bg-material-medium/50",
    "duration-200",
    "gap-1.5 p-1 text-xs",
    hasMultipleModels && "px-2",
    "border-border/50 bg-material-ultra-thin",
    "text-text-secondary",

    className,
  )
  const modelContent = (
    <>
      <i className={cn("size-3", iconClass)} />
      {/* Hidden in a narrow panel, where the button's label still names the model */}
      <span className="hidden max-w-20 truncate @md:inline">{modelLabel}</span>
      {hasMultipleModels && <i className="i-mingcute-down-line size-3 opacity-60" />}
    </>
  )

  if (!hasMultipleModels) {
    return <div className={modelContentClassName}>{modelContent}</div>
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("chat.model.label", { model: modelLabel })}
          className={cn(
            modelContentClassName,
            "outline-none focus-visible:ring-2 focus-visible:ring-border",
          )}
        >
          {modelContent}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {availableModelsMenu.map(({ label, value }, index) => {
          if (value) {
            const { provider: itemProvider, modelName: itemModelName } = parseModelString(value)
            const itemIconClass = providerIcons[itemProvider] || providerIcons.auto
            const isSelected = value === (currentModel || defaultModel)

            const handleModelSelect = () => {
              changeModel(value)
              onModelChange?.(value)
            }

            return (
              <DropdownMenuItem
                key={value}
                className="gap-2"
                onClick={handleModelSelect}
                checked={isSelected}
              >
                <i className={cn("size-3", itemIconClass)} />
                <span className="truncate">{label || itemModelName}</span>
              </DropdownMenuItem>
            )
          } else {
            return (
              <Fragment key={label}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{label}</DropdownMenuLabel>
              </Fragment>
            )
          }
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

AIModelIndicator.displayName = "AIModelIndicator"
