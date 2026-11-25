import { ResponsiveSelect } from "@follow/components/ui/select/responsive.js"
import { useTypeScriptHappyCallback } from "@follow/hooks"
import { ACTION_LANGUAGE_MAP } from "@follow/shared"
import { IN_ELECTRON } from "@follow/shared/constants"
import type { GeneralSettings } from "@follow/shared/settings/interface"
import { cn } from "@follow/utils/utils"
import dayjs from "dayjs"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { currentSupportedLanguages } from "~/@types/constants"
import { defaultResources } from "~/@types/default-resource"
import { useImageProxy } from "~/atoms/image-proxy"
import { useServerCapability } from "~/atoms/server-configs"
import {
  DEFAULT_ACTION_LANGUAGE,
  setGeneralSetting,
  useGeneralSettingKey,
  useGeneralSettingSelector,
  useGeneralSettingValue,
} from "~/atoms/settings/general"
import { useDialog } from "~/components/ui/modal/stacked/hooks"
import { useProxyValue, useSetProxy } from "~/hooks/biz/useProxySetting"
import { useMinimizeToTrayValue, useSetMinimizeToTray } from "~/hooks/biz/useTraySetting"
import { fallbackLanguage } from "~/i18n"
import { ipcServices } from "~/lib/client"
import { setTranslationCache } from "~/modules/entry-content/atoms"

import { SettingDescription, SettingInput, SettingSwitch } from "../control"
import { createSetting } from "../helper/builder"
import {
  useWrapEnhancedSettingItem,
  WrapEnhancedSettingTab,
} from "../hooks/useWrapEnhancedSettingItem"
import { SettingItemGroup } from "../section"

const { defineSettingItem: _defineSettingItem, SettingBuilder } = createSetting(
  useGeneralSettingValue,
  setGeneralSetting,
)

const saveLoginSetting = (checked: boolean) => {
  ipcServices?.setting.setOpenAtLogin(checked)
  setGeneralSetting("appLaunchOnStartup", checked)
}

export const SettingGeneral = () => {
  const { t } = useTranslation("settings")
  useEffect(() => {
    ipcServices?.setting.getLoginItemSettings().then((settings) => {
      if (settings) {
        // On Windows `openAtLogin` only matches a login item registered without arguments,
        // `executableWillLaunchAtLogin` matches it with any arguments
        setGeneralSetting(
          "appLaunchOnStartup",
          settings.openAtLogin || settings.executableWillLaunchAtLogin === true,
        )
      }
    })
  }, [])

  const defineSettingItem = useWrapEnhancedSettingItem(
    _defineSettingItem,
    WrapEnhancedSettingTab.General,
  )

  const aiEnabled = useServerCapability("ai")
  const hasImageProxy = !!useImageProxy()
  const imageProxyMode = useGeneralSettingKey("imageProxyMode")
  const { ask } = useDialog()
  const reRenderKey = useGeneralSettingKey("enhancedSettings")

  return (
    <div className="mt-4">
      <SettingBuilder
        key={reRenderKey.toString()}
        settings={[
          {
            type: "title",
            value: t("general.app"),
          },

          defineSettingItem("appLaunchOnStartup", {
            label: t("general.launch_at_login"),
            hide: !ipcServices,
            onChange(value) {
              saveLoginSetting(value)
            },
          }),
          IN_ELECTRON && MinimizeToTraySetting,
          LanguageSelector,

          aiEnabled && {
            type: "title",
            value: t("general.action.title"),
          },
          aiEnabled &&
            defineSettingItem("summary", {
              label: t("general.action.summary.label"),
              description: t("general.action.summary.description"),
            }),
          aiEnabled &&
            defineSettingItem("translation", {
              label: t("general.action.translation.label"),
              description: t("general.action.translation.description"),
            }),
          aiEnabled && TranslationModeSelector,
          aiEnabled && ActionLanguageSelector,

          {
            type: "title",
            value: t("general.subscription"),
          },
          defineSettingItem("autoGroup", {
            label: t("general.auto_group.label"),
            description: t("general.auto_group.description"),
          }),
          defineSettingItem("hideAllReadSubscriptions", {
            label: t("general.hide_all_read_subscriptions.label"),
            description: t("general.hide_all_read_subscriptions.description"),
          }),

          {
            type: "title",
            value: t("general.timeline"),
          },
          defineSettingItem("unreadOnly", {
            label: t("general.unread_only.label"),
            description: t("general.unread_only.description"),
          }),
          defineSettingItem("groupByDate", {
            label: t("general.group_by_date.label"),
            description: t("general.group_by_date.description"),
          }),
          defineSettingItem("autoExpandLongSocialMedia", {
            label: t("general.auto_expand_long_social_media.label"),
            description: t("general.auto_expand_long_social_media.description"),
          }),
          defineSettingItem("dimRead", {
            label: t("general.dim_read.label"),
            description: t("general.dim_read.description"),
          }),

          { type: "title", value: t("general.mark_as_read.title") },

          defineSettingItem("scrollMarkUnread", {
            label: t("general.mark_as_read.scroll.label"),
            description: t("general.mark_as_read.scroll.description"),
          }),

          defineSettingItem("hoverMarkUnread", {
            label: t("general.mark_as_read.hover.label"),
            description: t("general.mark_as_read.hover.description"),
          }),
          defineSettingItem("renderMarkUnread", {
            label: t("general.mark_as_read.render.label"),
            description: t("general.mark_as_read.render.description"),
          }),

          { type: "title", value: t("general.network") },
          IN_ELECTRON && NettingSetting,
          hasImageProxy && ImageProxySelector,
          hasImageProxy &&
            imageProxyMode !== "off" &&
            defineSettingItem("imageProxyFallback", {
              label: t("general.image_proxy_fallback.label"),
              description: t("general.image_proxy_fallback.description"),
            }),

          { type: "title", value: t("general.advanced") },

          defineSettingItem("enhancedSettings", {
            label: t("general.enhanced.label"),
            description: t("general.enhanced.description"),
            onChangeGuard(value) {
              if (value) {
                ask({
                  variant: "danger",
                  title: t("general.enhanced.enable.modal.title"),
                  message: t("general.enhanced.enable.modal.description"),
                  confirmText: t("general.enhanced.enable.modal.confirm"),
                  cancelText: t("general.enhanced.enable.modal.cancel"),
                  onConfirm: () => {
                    setGeneralSetting("enhancedSettings", value)
                  },
                })
                return "handled"
              }
            },
          }),
        ]}
      />
    </div>
  )
}

export const LanguageSelector = ({
  containerClassName,
  contentClassName,

  showDescription = true,
}: {
  containerClassName?: string
  contentClassName?: string
  showDescription?: boolean
}) => {
  const { t } = useTranslation("settings")
  const language = useGeneralSettingSelector((state) => state.language)

  const finalRenderLanguage = currentSupportedLanguages.includes(language)
    ? language
    : fallbackLanguage

  return (
    <div className={cn("mt-4 mb-3 flex w-full items-center", containerClassName)}>
      <div className="flex grow flex-col gap-1">
        <span className="shrink-0 text-sm font-medium">{t("general.language.title")}</span>
        {showDescription && (
          <SettingDescription>{t("general.language.description")}</SettingDescription>
        )}
      </div>

      <ResponsiveSelect
        size="sm"
        triggerClassName="w-48"
        triggerTestId="settings-language-select"
        contentClassName={contentClassName}
        defaultValue={finalRenderLanguage}
        value={finalRenderLanguage}
        onValueChange={(value) => {
          setGeneralSetting("language", value as string)
          dayjs.locale(value)
        }}
        renderValue={useTypeScriptHappyCallback((item) => {
          return <span>{defaultResources[item.value].lang.name}</span>
        }, [])}
        renderItem={useTypeScriptHappyCallback((item) => {
          const lang = item.value
          const percent = I18N_COMPLETENESS_MAP[lang]

          const originalLanguageName = defaultResources[lang].lang.name

          return (
            <span className="group" key={lang}>
              <span>
                {originalLanguageName}
                {typeof percent === "number" ? (percent >= 100 ? null : ` (${percent}%)`) : null}
              </span>
            </span>
          )
        }, [])}
        items={currentSupportedLanguages.map((lang) => ({
          label: `langs.${lang}`,
          value: lang,
        }))}
      />
    </div>
  )
}

const TranslationModeSelector = () => {
  const { t } = useTranslation("settings")
  const translationMode = useGeneralSettingKey("translationMode")

  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <span className="shrink-0 text-sm font-medium">{t("general.translation_mode.label")}</span>
        <ResponsiveSelect
          size="sm"
          triggerClassName="w-48"
          defaultValue={translationMode}
          value={translationMode}
          onValueChange={(value) => {
            setGeneralSetting("translationMode", value as "bilingual" | "translation-only")
          }}
          items={[
            { label: t("general.translation_mode.bilingual"), value: "bilingual" },
            { label: t("general.translation_mode.translation-only"), value: "translation-only" },
          ]}
        />
      </div>
      <SettingDescription>{t("general.translation_mode.description")}</SettingDescription>
    </>
  )
}

const ImageProxySelector = () => {
  const { t } = useTranslation("settings")
  const imageProxyMode = useGeneralSettingKey("imageProxyMode")

  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <span className="shrink-0 text-sm font-medium">{t("general.image_proxy.label")}</span>
        <ResponsiveSelect
          size="sm"
          triggerClassName="w-48"
          value={imageProxyMode}
          onValueChange={(value) => {
            setGeneralSetting("imageProxyMode", value as GeneralSettings["imageProxyMode"])
          }}
          items={[
            { label: t("general.image_proxy.off"), value: "off" },
            { label: t("general.image_proxy.hotlink"), value: "hotlink" },
            { label: t("general.image_proxy.all"), value: "all" },
          ]}
        />
      </div>
      <SettingDescription>{t("general.image_proxy.description")}</SettingDescription>
    </>
  )
}

const ActionLanguageSelector = () => {
  const { t } = useTranslation("settings")
  const actionLanguage = useGeneralSettingKey("actionLanguage")

  return (
    <div className="mt-4 mb-3 flex w-full gap-1">
      <div className="flex grow flex-col gap-1">
        <span className="shrink-0 text-sm font-medium">{t("general.action_language.label")}</span>
        <SettingDescription>{t("general.action_language.description")}</SettingDescription>
      </div>

      <ResponsiveSelect
        size="sm"
        triggerClassName="w-48"
        triggerTestId="settings-action-language-select"
        defaultValue={actionLanguage}
        value={actionLanguage}
        onValueChange={(value) => {
          setGeneralSetting("actionLanguage", value)
          setTranslationCache({})
        }}
        items={[
          { label: t("general.action_language.default"), value: DEFAULT_ACTION_LANGUAGE },
          ...Object.values(ACTION_LANGUAGE_MAP).map((item) => ({
            label: defaultResources[item.value].lang.name,
            value: item.value,
          })),
        ]}
      />
    </div>
  )
}

const NettingSetting = () => {
  const { t } = useTranslation("settings")
  const proxyConfig = useProxyValue()
  const setProxyConfig = useSetProxy()
  // Applied on blur or Enter: every keystroke would otherwise reset the session proxy, and the
  // partial values in between are invalid
  const [draft, setDraft] = useState<string | null>(null)
  const [isInvalid, setIsInvalid] = useState(false)

  const applyDraft = async () => {
    if (draft === null) return
    const input = draft.trim()
    // A host and port without a scheme, as most proxy apps show it, is an HTTP proxy
    const proxy = input && !input.includes("://") ? `http://${input}` : input
    const accepted = await setProxyConfig(proxy)
    const invalid = !!proxy && !accepted
    setIsInvalid(invalid)
    if (!invalid) setDraft(null)
  }

  return (
    <SettingItemGroup>
      <SettingInput
        type="text"
        label={t("general.proxy.label")}
        labelClassName="w-[150px]"
        value={draft ?? proxyConfig}
        onChange={(event) => {
          setDraft(event.target.value)
          setIsInvalid(false)
        }}
        onBlur={applyDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
      />
      {isInvalid && (
        <SettingDescription className="text-red">{t("general.proxy.invalid")}</SettingDescription>
      )}
      <SettingDescription>{t("general.proxy.description")}</SettingDescription>
    </SettingItemGroup>
  )
}

const MinimizeToTraySetting = () => {
  const { t } = useTranslation("settings")
  const minimizeToTray = useMinimizeToTrayValue()
  const setMinimizeToTray = useSetMinimizeToTray()
  return (
    <SettingItemGroup>
      <SettingSwitch
        checked={minimizeToTray}
        className="mt-4"
        onCheckedChange={setMinimizeToTray}
        label={t("general.minimize_to_tray.label")}
      />
      <SettingDescription>{t("general.minimize_to_tray.description")}</SettingDescription>
    </SettingItemGroup>
  )
}
