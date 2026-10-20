import { describe, expect, it } from "vitest"

import { describeAuthError } from "./auth-error"

describe("describeAuthError", () => {
  const translate = (key: string) => `translated ${key}`

  it("translates the auth server's rate limit, with or without its code", () => {
    expect(
      describeAuthError(
        {
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please try again later.",
          status: 429,
        },
        translate,
      ),
    ).toBe("translated auth.error.too_many_requests")
    expect(describeAuthError({ status: 429, statusText: "Too Many Requests" }, translate)).toBe(
      "translated auth.error.too_many_requests",
    )
  })

  it("translates a password sign-in the server refused for the email or the password", () => {
    expect(
      describeAuthError(
        { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password", status: 401 },
        translate,
      ),
    ).toBe("translated auth.error.invalid_email_or_password")
  })

  it("keeps what the server said about anything else", () => {
    expect(
      describeAuthError(
        { code: "USER_ALREADY_EXISTS", message: "User already exists", status: 422 },
        translate,
      ),
    ).toBe("User already exists")
    expect(describeAuthError({ code: "toString", message: "Not a known code" }, translate)).toBe(
      "Not a known code",
    )
    expect(describeAuthError({ status: 500, statusText: "Internal Server Error" }, translate)).toBe(
      "Internal Server Error",
    )
  })
})
