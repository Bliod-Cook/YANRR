import { Logo } from "@follow/components/icons/logo.jsx"
import { Wordmark } from "@follow/components/icons/wordmark.jsx"
import { MODE, ModeEnum } from "@follow/shared/constants"
import { getCurrentEnvironment } from "@follow/utils/environment"
import PKG from "@pkg"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"

import { PlainWithAnimationModal } from "~/components/ui/modal/stacked/custom-modal"
import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { ipcServices } from "~/lib/client"
import { EnvironmentDebugModalContent } from "~/modules/app/EnvironmentIndicator"
import { AppTipModalContent } from "~/modules/app-tip"

export const SettingAbout = () => {
  const { t } = useTranslation("settings")
  const { present } = useModalStack()
  const currentEnvironment = getCurrentEnvironment().join("\n")
  const { data: appVersion } = useQuery({
    queryKey: ["appVersion"],
    queryFn: () => ipcServices!.app.getAppVersion(),
    // Only Electron has an app version; the web build would resolve undefined, which React Query rejects
    enabled: !!ipcServices,
  })

  const rendererVersion = PKG.version
  const rendererClickCountRef = useRef(0)
  const rendererClickResetTimerRef = useRef<number | null>(null)
  const lastRendererClickTimestampRef = useRef(0)

  useEffect(() => {
    return () => {
      if (rendererClickResetTimerRef.current) {
        window.clearTimeout(rendererClickResetTimerRef.current)
      }
    }
  }, [])

  const handleRendererVersionClick = () => {
    if (!rendererVersion) return

    const now = Date.now()
    if (now - lastRendererClickTimestampRef.current > 800) {
      rendererClickCountRef.current = 0
    }

    rendererClickCountRef.current += 1
    lastRendererClickTimestampRef.current = now

    if (rendererClickResetTimerRef.current) {
      window.clearTimeout(rendererClickResetTimerRef.current)
    }

    rendererClickResetTimerRef.current = window.setTimeout(() => {
      rendererClickCountRef.current = 0
      rendererClickResetTimerRef.current = null
    }, 800)

    if (rendererClickCountRef.current >= 10) {
      rendererClickCountRef.current = 0
      if (rendererClickResetTimerRef.current) {
        window.clearTimeout(rendererClickResetTimerRef.current)
        rendererClickResetTimerRef.current = null
      }

      present({
        title: "Debug Actions",
        content: EnvironmentDebugModalContent,
      })
    }
  }

  const handleOpenAppTip = () => {
    present({
      title: t("about.appTip"),
      content: () => <AppTipModalContent />,
      CustomModalComponent: PlainWithAnimationModal,
      modalContainerClassName: "flex items-center justify-center",
      modalClassName: "w-full max-w-5xl",
      canClose: true,
      clickOutsideToDismiss: false,
      overlay: false,
    })
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-8">
      {/* Header Section */}
      <div className="px-2 text-center">
        <div className="mb-6 flex justify-center">
          <Logo className="size-20" />
        </div>
        <h1 className="text-4xl">
          <Wordmark />
        </h1>
        {MODE !== ModeEnum.production && (
          <span className="mt-1 block text-sm font-normal text-text-tertiary">{MODE}</span>
        )}
        <p className="mt-2 text-sm text-text-secondary">
          {t("about.licenseInfo", { appName: APP_NAME, currentYear: new Date().getFullYear() })}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {appVersion && (
            <span className="inline-flex items-center rounded-full bg-fill-secondary px-3 py-1 text-xs font-medium text-text-secondary">
              <span className="mr-1.5 text-text-tertiary">{t("about.appVersion")}</span>
              {appVersion}
            </span>
          )}
          {rendererVersion && (
            <button
              type="button"
              onClick={handleRendererVersionClick}
              className="inline-flex items-center rounded-full bg-fill-secondary px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-fill-tertiary"
            >
              <span className="mr-1.5 text-text-tertiary">{t("about.rendererVersion")}</span>
              {rendererVersion}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(
                rendererVersion
                  ? `${currentEnvironment}\n**Renderer**: ${rendererVersion}`
                  : currentEnvironment,
              )
              toast.success(t("about.environmentCopied"))
            }}
            className="inline-flex items-center rounded-full px-3 py-1 text-xs text-text-tertiary transition-colors hover:bg-fill-secondary hover:text-text-secondary"
          >
            <i className="i-mgc-copy-cute-re mr-1.5" />
            {t("about.copyEnvironment")}
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="-mx-3 space-y-1 px-2">
        <button
          type="button"
          onClick={handleOpenAppTip}
          className="group flex w-full items-center justify-between rounded-lg p-3 text-left transition-all hover:bg-fill-secondary hover:shadow-sm"
        >
          <div>
            <div className="text-sm font-medium">{t("about.appTip")}</div>
            <div className="text-xs text-text-tertiary">{t("about.appTipDescription")}</div>
          </div>
          <i className="i-mingcute-sparkles-2-line text-base text-text-tertiary transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
        </button>
      </div>

      {/* Resources Section */}
      <div className="px-2">
        <h2 className="mb-4 text-sm font-semibold text-text-secondary">{t("about.resources")}</h2>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-text-secondary">
            {t("about.projectLicense", { appName: APP_NAME })}
          </p>
          <p className="text-sm leading-relaxed text-text-secondary">
            <Trans
              ns="settings"
              i18nKey="about.iconLibrary"
              components={{
                IconLibraryLink: (
                  <a
                    className="text-accent hover:underline"
                    href="https://mgc.mingcute.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    MingCute Icons
                  </a>
                ),
              }}
            />
          </p>
        </div>
      </div>
    </div>
  )
}
