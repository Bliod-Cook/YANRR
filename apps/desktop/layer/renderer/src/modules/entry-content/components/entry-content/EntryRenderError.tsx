import { useTranslation } from "react-i18next"

import type { FallbackRender } from "~/components/common/ErrorBoundary"

export const EntryRenderError: FallbackRender = ({ error }) => {
  const { t } = useTranslation()
  const nextError = typeof error === "string" ? new Error(error) : (error as Error)
  return (
    <div className="center mt-16 flex flex-col gap-2">
      <i className="i-mingcute-close-line text-3xl text-red" />
      <span className="font-sans text-sm">
        {t("entry_content.render_error")} {nextError.message}
      </span>
    </div>
  )
}
