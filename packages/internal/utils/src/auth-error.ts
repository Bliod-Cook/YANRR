/**
 * Codes the auth server refuses a sign-in or sign-up with, in an error's `code`. The values are
 * the keys of their messages in the common locales.
 */
const AUTH_ERROR_MESSAGE_KEYS = {
  // A password sign-in with an email that has no account, or with the wrong password
  INVALID_EMAIL_OR_PASSWORD: "auth.error.invalid_email_or_password",
  // Too many sign-up or sign-in attempts
  TOO_MANY_REQUESTS: "auth.error.too_many_requests",
} as const

type AuthErrorMessageKey = (typeof AUTH_ERROR_MESSAGE_KEYS)[keyof typeof AUTH_ERROR_MESSAGE_KEYS]

const getAuthErrorMessageKey = (code: unknown): AuthErrorMessageKey | undefined =>
  typeof code === "string" && Object.hasOwn(AUTH_ERROR_MESSAGE_KEYS, code)
    ? AUTH_ERROR_MESSAGE_KEYS[code as keyof typeof AUTH_ERROR_MESSAGE_KEYS]
    : undefined

/** An error the auth client resolves with */
export interface AuthClientError {
  code?: string
  message?: string
  status?: number
  statusText?: string
}

/**
 * What to tell the user about an error the auth client resolved with: the translation of a code
 * the server explains, otherwise what the server said.
 */
export const describeAuthError = (
  error: AuthClientError | null | undefined,
  translate: (key: AuthErrorMessageKey) => string,
): string => {
  const messageKey =
    getAuthErrorMessageKey(error?.code) ??
    // Better Auth's own limits answer 429 without a code
    (error?.status === 429 ? AUTH_ERROR_MESSAGE_KEYS.TOO_MANY_REQUESTS : undefined)
  if (messageKey) return translate(messageKey)
  return error?.message || error?.statusText || error?.code || "Unknown error"
}
