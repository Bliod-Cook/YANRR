import { useTranslation } from "react-i18next"

import { ActionSetting } from "~/modules/action/action-setting"
import { useSubViewTitle } from "~/modules/app-layout/subview/hooks"

export function Component() {
  const { t } = useTranslation("common")

  useSubViewTitle("words.actions")

  return (
    <div className="-mt-6 flex size-full min-h-[calc(100vh-8rem)] flex-col px-6">
      {/* Simple Header */}
      <div className="mx-auto max-w-6xl text-center">
        <h1 className="mb-4 text-3xl font-bold text-text">{t("words.actions")}</h1>
      </div>

      {/* Content */}
      <div className="@container relative mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        <ActionSetting />
      </div>
    </div>
  )
}
