import { Logo } from "@follow/components/icons/logo.jsx"
import { Button } from "@follow/components/ui/button/index.js"
import type { FC } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { CustomSafeError } from "../../errors/CustomSafeError"
import type { AppErrorFallbackProps } from "../common/AppErrorBoundary"
import { useResetErrorWhenRouteChange } from "./helper"

const EntryNotFoundErrorFallback: FC<AppErrorFallbackProps> = ({ resetError, error }) => {
  if (!(error instanceof EntryNotFound)) {
    throw error
  }

  useResetErrorWhenRouteChange(resetError)
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center rounded-md bg-theme-background p-2">
      <div className="m-auto center flex max-w-prose flex-col gap-4 text-center">
        <div className="mb-8 center flex">
          <Logo className="size-20" />
        </div>
        <p className="font-semibold">{t("errors_page.entry_not_found")}</p>

        <div className="mt-12 center gap-4">
          <Button
            variant="outline"
            onClick={() => {
              navigate("/")
              setTimeout(() => {
                resetError()
              }, 100)
            }}
          >
            {t("words.back", { ns: "common" })}
          </Button>
        </div>
      </div>
    </div>
  )
}
export default EntryNotFoundErrorFallback

export class EntryNotFound extends CustomSafeError {
  constructor() {
    super("Entry 404")
  }
}
