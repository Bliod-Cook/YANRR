import { getI18n } from "~/i18n"

const parseServerError = (message: string): { code?: unknown; message?: unknown } | null => {
  try {
    const parsed: unknown = JSON.parse(message)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

/**
 * What to tell the user about a failed reply. The server answers a failed request, and ends a
 * failed reply, with its error body `{ code, message }`, whose code the error locales translate.
 * Any other message is shown as it is.
 */
export const getChatErrorMessage = (error: Error | string): string => {
  const rawMessage = typeof error === "string" ? error : error.message
  const serverError = parseServerError(rawMessage)
  if (!serverError) return rawMessage

  const serverMessage = typeof serverError.message === "string" ? serverError.message : rawMessage
  const key = `errors:${String(serverError.code)}`
  const i18n = getI18n()
  return typeof serverError.code === "number" && i18n.exists(key)
    ? i18n.t(key as never)
    : serverMessage
}
