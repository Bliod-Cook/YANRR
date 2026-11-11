import { FollowAPIError, FollowTimeoutError } from "@follow-app/client-sdk"
import { MutationObserver, onlineManager } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryClient } from "./query-client"

describe("queryClient while the browser is offline", () => {
  afterEach(() => {
    onlineManager.setOnline(true)
    queryClient.getMutationCache().clear()
  })

  it("runs mutations at once, so their intent reaches the transaction queue", async () => {
    onlineManager.setOnline(false)
    const mutationFn = vi.fn(async (entryId: string) => entryId)

    const result = await new MutationObserver(queryClient, { mutationFn }).mutate("entry-1")

    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(result).toBe("entry-1")
  })
})

describe("queryClient retries", () => {
  const retry = queryClient.getDefaultOptions().queries!.retry as (
    failureCount: number,
    error: Error,
  ) => boolean

  it("does not retry a timeout, which already waited the whole time", () => {
    expect(retry(0, new FollowTimeoutError())).toBe(false)
  })

  it("retries server errors", () => {
    expect(retry(0, new FollowAPIError("Internal error", 500))).toBe(true)
    expect(retry(3, new FollowAPIError("Internal error", 500))).toBe(false)
  })
})
