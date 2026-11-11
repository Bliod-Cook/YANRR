import { FollowAPIError } from "@follow-app/client-sdk"
import { FetchError } from "ofetch"
import { describe, expect, it, vi } from "vitest"

import { isUnauthorized } from "./EntryContentFallback"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))

describe("isUnauthorized", () => {
  it("is true for a 401 of the API client", () => {
    expect(isUnauthorized(new FollowAPIError("Unauthorized", 401))).toBe(true)
  })

  it("is false for other API errors and for errors the client does not throw", () => {
    expect(isUnauthorized(new FollowAPIError("Internal error", 500))).toBe(false)
    const fetchError = Object.assign(new FetchError("Unauthorized"), { statusCode: 401 })
    expect(isUnauthorized(fetchError)).toBe(false)
  })
})
