import type { AuthClientError } from "@follow/utils/auth-error"
import { describeAuthError } from "@follow/utils/auth-error"
import { ExceptionCodeMap, FollowAPIError } from "@follow-app/client-sdk"
import { t } from "i18next"
import type { ExternalToast } from "sonner"
import { toast } from "sonner"

import { getApiUnreachable } from "~/atoms/api-connection"

// How fetch fails when no answer came back, offline or with the API down: each browser words it
// its own way, and a request the main process made for the window comes back as "fetch failed"
const CONNECTION_FAILURE_MESSAGE =
  /^(?:failed to fetch|load failed|networkerror when attempting to fetch resource\.?)$|\bfetch failed\b/iu

/** The request got no answer at all, so the browser's own wording would say nothing useful */
export const isConnectionFailure = (error: Error) =>
  !(error instanceof FollowAPIError) && CONNECTION_FAILURE_MESSAGE.test(error.message)

/** The server answers this when a feature is not configured: the feature is off, not broken */
const MISSING_CONFIGURATION_CODE = 5

export const isMissingConfiguration = (error: unknown) =>
  error instanceof FollowAPIError && getServerCode(error) === MISSING_CONFIGURATION_CODE

/**
 * The code of the server's answer, which the error locales translate. `code` names some errors
 * the SDK's own way, such as AUTH_REQUIRED for a refused session, whose server code is 1000, or
 * 1008 for a guest who has to sign in first.
 */
const getServerCode = (error: FollowAPIError) => {
  if (error.serverCode !== undefined) return error.serverCode
  const code = Number(error.code)
  return error.code && !Number.isNaN(code) ? code : undefined
}

/** What to tell the user about an error the auth client resolved with, translated where it can */
export const getAuthErrorMessage = (error: AuthClientError | null | undefined) =>
  describeAuthError(error, (key) => t(key, { ns: "common" }))

// i18next answers a missing key with the key without its namespace, such as "1000"
const translateErrorCode = (code: unknown, fallback: string) => {
  if (code == null) return fallback
  const translated: unknown = t(`errors:${code}` as never)
  return typeof translated === "string" && translated && translated !== `${code}`
    ? translated
    : fallback
}

const getFetchErrorInfo = (error: Error): { message: string; code?: number } => {
  if (error instanceof FollowAPIError) {
    const code = getServerCode(error)
    return { message: translateErrorCode(code, error.message), code }
  }

  if (isConnectionFailure(error)) {
    return { message: t("common:app.api_unreachable") }
  }

  return { message: error.message }
}

export const getFetchErrorMessage = (error: Error) => {
  const { message } = getFetchErrorInfo(error)
  return message
}

/**
 * Just a wrapper around `toastFetchError` to create a function that can be used as a callback.
 */
export const createErrorToaster = (title?: string, toastOptions?: ExternalToast) => (err: Error) =>
  toastFetchError(err, { title, ...toastOptions })

export const toastFetchError = (
  error: Error,
  { title, ...toastOptions }: ExternalToast & { title?: string } = {},
) => {
  // The notice of an unreachable server says the same and stays until it answers again
  if (!title && isConnectionFailure(error) && getApiUnreachable()) return

  const { message, code } = getFetchErrorInfo(error)
  // Every request validation failure has this code; only the server's message names the field
  const detail =
    code === ExceptionCodeMap.UnprocessableContent && error.message !== message ? error.message : ""

  return toast.error(title || message || t("common:error_screen.unknown"), {
    ...toastOptions,
    classNames: {
      toast: "items-start bg-theme-background",
      content: "w-full",
      ...toastOptions.classNames,
    },
    description: title ? detail || message : detail,
  })
}
