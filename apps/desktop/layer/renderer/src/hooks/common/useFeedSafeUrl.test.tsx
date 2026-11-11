import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { useFeedStore } from "@follow/store/feed/store"
import type { FeedModel } from "@follow/store/feed/types"
import { useInboxStore } from "@follow/store/inbox/store"
import type { InboxModel } from "@follow/store/inbox/types"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, test } from "vitest"

import { useFeedSafeUrl } from "./useFeedSafeUrl"

const entry = (id: string, fields: Partial<EntryModel>) =>
  ({ id, feedId: "feed-1", inboxHandle: null, url: null, authorUrl: null, ...fields }) as EntryModel

const safeUrlOf = async (entryId: string) => {
  let result: string | null | undefined
  const Probe = () => {
    result = useFeedSafeUrl(entryId)
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => {
    root.render(<Probe />)
  })
  await act(async () => {
    root.unmount()
  })
  return result
}

describe("useFeedSafeUrl", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    useFeedStore.setState({
      feeds: {
        "feed-1": { id: "feed-1", type: "feed", siteUrl: "https://example.com/blog/" } as FeedModel,
      },
    })
    useInboxStore.setState({ inboxes: { mail: { id: "mail", type: "inbox" } as InboxModel } })
    useEntryStore.setState({
      data: {
        relative: entry("relative", { url: "posts/1" }),
        script: entry("script", { url: "javascript:alert(1)" }),
        email: entry("email", {
          feedId: null,
          inboxHandle: "mail",
          authorUrl: "mailto:sender@example.com",
        }),
      },
    })
  })

  test("resolves a relative link against the site of the feed", async () => {
    expect(await safeUrlOf("relative")).toBe("https://example.com/blog/posts/1")
  })

  test("gives no link that is not a web page", async () => {
    expect(await safeUrlOf("script")).toBeNull()
    expect(await safeUrlOf("email")).toBeNull()
  })
})
