import { FollowTimeoutError } from "@follow-app/client-sdk"

/**
 * expo/fetch rejects with "fetch failed: <native reason>" when no response came back, e.g.
 * "java.net.ConnectException: Failed to connect to …". A request the app cancelled says
 * "aborted" or "canceled" instead.
 */
export const isConnectionFailure = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.startsWith("fetch failed:") &&
  !/aborted|canceled/i.test(error.message)

/**
 * The request was not sent, as the stored session could not be read: the keychain refuses access
 * before the first unlock, for instance. The session may well be there.
 */
export class SessionReadError extends Error {
  constructor(options: ErrorOptions) {
    super("The stored session could not be read", options)
    this.name = "SessionReadError"
  }
}

/**
 * Whether a request got no answer at all, as offline, with the API down, when it timed out or
 * could not read the session. It may well work later, unlike a request the server answered with
 * an error.
 */
export const isUnansweredRequestError = (error: unknown) =>
  error instanceof FollowTimeoutError ||
  error instanceof SessionReadError ||
  isConnectionFailure(error)
