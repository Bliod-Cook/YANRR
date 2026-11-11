import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@follow/components/ui/tooltip/index.js"
import type { BizUIMetadata } from "@folo-services/ai-tools"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { formatTokenCountString } from "~/modules/settings/tabs/ai/usage/utils"

interface TokenUsagePillProps {
  metadata: BizUIMetadata | undefined
  className?: string
  children: React.ReactNode
}

const formatDuration = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

interface ModelInfoSectionProps {
  metadata: BizUIMetadata
}

const ModelInfoSection: React.FC<ModelInfoSectionProps> = ({ metadata }) => {
  const { t } = useTranslation("ai")
  const hasProviderInfo = metadata.provider != null || metadata.providerType != null

  return (
    <>
      <div className="mb-2 flex flex-col gap-2">
        <div className="text-xs text-text">{t("token_usage_pill.model_info")}</div>
        <div className="font-mono text-xs text-text-secondary">
          {metadata.modelUsed ?? t("token_usage_pill.unknown")}
        </div>
      </div>
      {hasProviderInfo && (
        <div className="mb-2 flex flex-col gap-2">
          <div className="text-xs text-text">{t("token_usage_pill.provider_info")}</div>
          <div className="font-mono text-xs text-text-secondary">
            <span>{metadata.provider ?? t("token_usage_pill.unknown")}</span>
            {metadata.providerType && (
              <span className="ml-2 text-text-tertiary">
                <span>(</span>
                <span>
                  {metadata.providerType === "byok"
                    ? t("token_usage_pill.byok")
                    : t("token_usage_pill.system")}
                </span>
                <span>)</span>
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

interface TokenUsageDetailsProps {
  metadata: BizUIMetadata
}

const TokenUsageDetails: React.FC<TokenUsageDetailsProps> = ({ metadata }) => {
  const { t } = useTranslation("ai")

  return (
    <>
      <ModelInfoSection metadata={metadata} />
      <div className="space-y-2 text-xs">
        <div className="font-medium text-text">{t("token_usage_pill.token_usage")}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {metadata.totalTokens != null && (
            <div className="flex justify-between gap-2">
              <span className="text-text-secondary">{t("token_usage_pill.total")}:</span>
              <span className="font-mono text-text">
                {formatTokenCountString(metadata.totalTokens)}
              </span>
            </div>
          )}
        </div>
        {metadata.duration != null && (
          <>
            <hr className="border-fill-secondary" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-text-secondary">{t("token_usage_pill.duration")}:</span>
                <span className="font-mono text-text">{formatDuration(metadata.duration)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

export const TokenUsagePill: React.FC<TokenUsagePillProps> = ({ metadata, children }) => {
  if (!metadata) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side="top" className="p-2" align="center" sideOffset={8}>
          <TokenUsageDetails metadata={metadata} />
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  )
}
