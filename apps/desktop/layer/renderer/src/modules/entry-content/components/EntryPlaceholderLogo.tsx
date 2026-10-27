import { Logo } from "@follow/components/icons/logo.jsx"
import { Button } from "@follow/components/ui/button/index.js"
import {
  DEFAULT_RECOMMEND_FEEDS_SHORTCUT_ID,
  DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
} from "@follow/shared/settings/defaults"
import { stopPropagation } from "@follow/utils/dom"
import { useSetAtom } from "jotai"
import type { ReactNode } from "react"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"

import { useFeature } from "~/hooks/biz/useFeature"
import { useSendAIShortcut } from "~/modules/ai-chat/hooks/useSendAIShortcut"
import { aiTimelineEnabledAtom } from "~/modules/entry-column/atoms/ai-timeline"
import { useSettingModal } from "~/modules/settings/modal/use-setting-modal-hack"

export const EntryPlaceholderLogo = () => {
  const aiEnabled = useFeature("ai")

  return (
    <div
      data-hide-in-print
      onContextMenu={stopPropagation}
      className={
        "flex w-full min-w-0 flex-col items-center justify-center gap-2 px-12 pb-6 text-center text-lg font-medium text-text-secondary duration-500"
      }
    >
      {aiEnabled ? <AIPlaceholder /> : <PlainPlaceholder />}
    </div>
  )
}

const PlainPlaceholder = () => {
  const { t } = useTranslation()

  return (
    <>
      <Logo className="size-16 opacity-40 grayscale" />
      <div>{t("entry_content.placeholder.title")}</div>
    </>
  )
}

const AIPlaceholder = () => {
  const { t } = useTranslation()
  const { sendAIShortcut, hasShortcut } = useSendAIShortcut()
  const setAiTimelineEnabled = useSetAtom(aiTimelineEnabledAtom)
  const settingModalPresent = useSettingModal()
  const handleToggleAiTimeline = useCallback(() => {
    setAiTimelineEnabled((prev) => !prev)
  }, [setAiTimelineEnabled])

  const shortcutButton = (shortcutId: string, label: string, icon: string) =>
    hasShortcut(shortcutId) && {
      label,
      onClick: () => void sendAIShortcut({ shortcutId, ensureNewChat: true }),
      icon: <i className={`${icon} text-base`} />,
    }
  const buttons = [
    shortcutButton(
      DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
      t("entry_content.placeholder.summarize_timeline"),
      "i-mgc-paint-brush-ai-cute-re",
    ),
    shortcutButton(
      DEFAULT_RECOMMEND_FEEDS_SHORTCUT_ID,
      t("entry_content.placeholder.suggest_feeds"),
      "i-mgc-search-ai-cute-re",
    ),
    {
      label: t("entry_content.placeholder.sort_timeline"),
      onClick: handleToggleAiTimeline,
      icon: <i className="i-mgc-refresh-4-ai-cute-re text-base" />,
    },
    {
      label: t("entry_content.placeholder.personalize_ai"),
      onClick: () => settingModalPresent("ai"),
      icon: <i className="i-mgc-ai-cute-re text-base" />,
    },
  ].filter((button): button is { label: string; onClick: () => void; icon: ReactNode } => !!button)

  return (
    <>
      <i className="i-mgc-ai-cute-re size-16 text-text-tertiary" />
      <div>{t("entry_content.placeholder.title")}</div>
      <div className="mt-4 flex flex-col gap-2">
        {buttons.map((button) => (
          <Button
            key={button.label}
            type="button"
            onClick={button.onClick}
            buttonClassName="justify-start"
            textClassName="flex items-center gap-2 text-purple-600 dark:text-purple-400"
            variant="ghost"
          >
            {button.icon}
            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent dark:from-purple-400 dark:to-blue-400">
              {button.label}
            </span>
          </Button>
        ))}
      </div>
    </>
  )
}
