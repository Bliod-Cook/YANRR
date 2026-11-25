import { Button } from "@follow/components/ui/button/index.js"
import type { FC } from "react"
import { useTranslation } from "react-i18next"

import { attachOpenInEditor } from "~/lib/dev"

import type { AppErrorFallbackProps } from "../common/AppErrorBoundary"
import { parseError, useResetErrorWhenRouteChange } from "./helper"

const PageErrorFallback: FC<AppErrorFallbackProps> = (props) => {
  const { message, stack } = parseError(props.error)
  useResetErrorWhenRouteChange(props.resetError)
  const { t } = useTranslation()
  return (
    <div className="pointer-events-auto flex w-full flex-col items-center justify-center rounded-md bg-theme-background p-2">
      <div className="m-auto max-w-prose text-center">
        <div className="mb-4">
          <i className="i-mgc-bug-cute-re text-4xl text-red-500" />
        </div>
        <div className="text-lg font-bold">{message}</div>
        {import.meta.env.DEV && stack ? (
          <pre className="mt-4 max-h-48 cursor-text overflow-auto rounded-md bg-red-50 p-4 text-left font-mono text-sm whitespace-pre-line text-red-600 select-text">
            {attachOpenInEditor(stack)}
          </pre>
        ) : null}

        <p className="my-8">{t("errors_page.temporary_problem", { appName: APP_NAME })}</p>

        <div className="center gap-4">
          <Button onClick={() => props.resetError()} variant="primary">
            {t("retry", { ns: "common" })}
          </Button>

          <Button onClick={() => window.location.reload()} variant="outline">
            {t("errors_page.reload")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default PageErrorFallback
