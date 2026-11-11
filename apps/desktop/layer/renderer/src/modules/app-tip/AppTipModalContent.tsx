import { Button } from "@follow/components/ui/button/index.js"
import { cn } from "@follow/utils/utils"
import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { GlassButton } from "~/components/ui/button/GlassButton"
import { useCurrentModal } from "~/components/ui/modal/stacked/hooks"

import { OpmlAbstractGraphic } from "../discover/OpmlAbstractGraphic"
import { OverviewMedia } from "./OverviewMedia"
import type { AppTipStep } from "./types"

export function AppTipModalContent() {
  const { dismiss } = useCurrentModal()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [activeStep, setActiveStep] = useState(0)

  const handleNavigateAndClose = useCallback(
    (path: string) => {
      dismiss()
      navigate(path)
    },
    [dismiss, navigate],
  )

  const steps = useMemo<AppTipStep[]>(() => {
    return [
      {
        id: "overview",
        title: t("new_user_dialog.overview.title"),
        description: t("new_user_dialog.overview.description"),
        highlights: [
          t("new_user_dialog.overview.highlight_1"),
          t("new_user_dialog.overview.highlight_2"),
          t("new_user_dialog.overview.highlight_3"),
        ],
        media: <OverviewMedia />,
        primaryActionLabel: t("new_user_dialog.overview.primary"),
        onPrimaryAction: () => handleNavigateAndClose("/discover?type=search"),
      },
      {
        id: "import",
        title: t("new_user_dialog.import.title"),
        description: t("new_user_dialog.import.description"),
        highlights: [
          t("new_user_dialog.import.highlight_1"),
          t("new_user_dialog.import.highlight_2"),
          t("new_user_dialog.import.highlight_3"),
        ],
        media: <OpmlAbstractGraphic />,
        primaryActionLabel: t("new_user_dialog.import.primary"),
        onPrimaryAction: () => handleNavigateAndClose("/discover?type=import"),
      },
    ]
  }, [handleNavigateAndClose, t])

  const activeStepData = steps[activeStep] ?? steps[0] ?? null
  const hasNextStep = activeStep < steps.length - 1

  if (!activeStepData) return null

  const handleNextStep = () => {
    if (hasNextStep) {
      setActiveStep(activeStep + 1)
    } else {
      dismiss()
    }
  }

  return (
    <section className="shadow-modal relative grid min-h-[500px] overflow-hidden rounded-lg border border-border bg-background text-text lg:grid-cols-[1.2fr,1fr]">
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-background">
        <div className="absolute inset-0 aspect-square w-full overflow-hidden bg-material-medium">
          {activeStepData.media}
        </div>
      </div>

      <div className="relative flex w-[500px] flex-col border-t border-border bg-background lg:border-l lg:border-t-0">
        <GlassButton
          onClick={dismiss}
          className="absolute right-4 top-4 z-10"
          aria-label={t("new_user_dialog.actions.close")}
        >
          <i className="i-mgc-close-cute-re" />
        </GlassButton>
        <div className="flex flex-1 flex-col gap-6 p-8">
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-semibold leading-tight text-text">
              {activeStepData.title}
            </h2>
            <p className="text-sm leading-relaxed text-text-secondary">
              {activeStepData.description}
            </p>
          </div>

          <ul className="space-y-2.5 text-sm text-text-secondary">
            {activeStepData.highlights.map((point, idx) => (
              <li key={`${activeStepData.id}-${idx}`} className="flex items-start gap-2.5">
                <span className="mt-2 flex size-1.5 rounded-full bg-text-tertiary" />
                <span className="leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {steps.map((step, idx) => (
                <button
                  type="button"
                  key={step.id}
                  onClick={() => setActiveStep(idx)}
                  aria-label={step.title}
                  aria-current={idx === activeStep}
                  className={cn(
                    "size-2 cursor-pointer rounded-full transition-colors",
                    idx === activeStep ? "bg-text" : "bg-fill-tertiary hover:bg-fill-secondary",
                  )}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={"outline"}
                buttonClassName="h-8"
                onClick={activeStepData.onPrimaryAction}
              >
                {activeStepData.primaryActionLabel}
              </Button>

              <Button size="sm" buttonClassName="h-8" onClick={handleNextStep}>
                {hasNextStep
                  ? t("words.next", { ns: "common" })
                  : t("new_user_dialog.actions.finish")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
