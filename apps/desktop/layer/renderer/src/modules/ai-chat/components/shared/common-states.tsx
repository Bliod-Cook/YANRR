import { useTranslation } from "react-i18next"

interface LoadingStateProps {
  description?: string
}

interface ErrorStateProps {
  error?: string
}

export const LoadingState = ({ description }: LoadingStateProps) => {
  const { t } = useTranslation("ai")
  return (
    <div className="flex h-32 animate-pulse items-center justify-center rounded-lg bg-material-medium text-sm text-text-tertiary">
      {description ?? t("chat.state.loading")}
    </div>
  )
}

export const ErrorState = ({ error }: ErrorStateProps) => {
  const { t } = useTranslation("ai")
  return (
    <div className="flex h-32 items-center justify-center rounded-lg bg-mix-red-background-1-4 text-sm text-text-tertiary">
      {error ?? t("chat.state.error")}
    </div>
  )
}
