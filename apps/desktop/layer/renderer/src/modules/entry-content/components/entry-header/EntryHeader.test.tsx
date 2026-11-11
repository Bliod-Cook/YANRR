import { setRoute } from "@follow/components/atoms/route.js"
import { GlobalFocusableProvider } from "@follow/components/common/Focusable/GlobalFocusableProvider.js"
import { initializeDayjs } from "@follow/components/dayjs"
import { FeedViewType } from "@follow/constants"
import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { useSubscriptionStore } from "@follow/store/subscription/store"
import type { SubscriptionModel } from "@follow/store/subscription/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Provider } from "jotai"
import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"
import { initializeDefaultGeneralSettings, setGeneralSetting } from "~/atoms/settings/general"
import { jotaiStore } from "~/lib/jotai"
import { useRegisterEntryCommands } from "~/modules/command/commands/entry"
import { COMMAND_ID } from "~/modules/command/commands/id"

import { EntryHeader } from "./EntryHeader"

// The auth client needs the API URL of a real build
vi.mock("~/lib/auth", () => ({}))

const post = {
  id: "post-1",
  title: "Post 1",
  url: "https://example.com/post-1",
  content: "<p>Hello</p>",
  readabilityContent: null,
  description: null,
  guid: "post-1",
  author: null,
  authorUrl: null,
  authorAvatar: null,
  insertedAt: new Date(),
  publishedAt: new Date(),
  media: null,
  categories: null,
  attachments: null,
  extra: null,
  language: null,
  feedId: "social",
  inboxHandle: null,
  read: false,
  settings: null,
} as EntryModel

const socialSubscription: SubscriptionModel = {
  feedId: "social",
  inboxId: null,
  userId: "user-1",
  view: FeedViewType.SocialMedia,
  hideFromTimeline: null,
  title: null,
  category: null,
  createdAt: null,
  type: "feed",
}

const EntryHeaderWithCommands = ({ entryId }: { entryId: string }) => {
  useRegisterEntryCommands()
  return <EntryHeader entryId={entryId} />
}

describe("EntryHeader", () => {
  let root: Root | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    initializeDayjs()
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    host?.remove()
    root = null
    host = null
    initializeDefaultGeneralSettings()
    setServerConfigs(null)
    setRoute({
      params: {},
      searchParams: new URLSearchParams(),
      location: { pathname: "", search: "", hash: "", state: null, key: "" },
    })
  })

  const renderHeader = async (view: FeedViewType) => {
    // Otherwise they apply by themselves, and their toggles are hidden for any entry
    setGeneralSetting("summary", false)
    setGeneralSetting("translation", false)
    useEntryStore.setState({ data: { [post.id]: post } })
    useSubscriptionStore.setState({ data: { social: { ...socialSubscription, view } } })
    setRoute({
      params: { timelineId: "all", entryId: post.id },
      searchParams: new URLSearchParams(),
      location: { pathname: "/timeline/all", search: "", hash: "", state: null, key: "" },
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={jotaiStore}>
            <GlobalFocusableProvider>
              <EntryHeaderWithCommands entryId={post.id} />
            </GlobalFocusableProvider>
          </Provider>
        </QueryClientProvider>,
      )
    })
    return (id: string) => host?.querySelector(`[data-command-id="${id}"]`)
  }

  // The social media and picture layouts render neither the AI summary nor the readability content
  test.each([FeedViewType.SocialMedia, FeedViewType.Pictures])(
    "leaves out the actions the layout of view %i ignores in the all timeline",
    async (view) => {
      const actionOf = await renderHeader(view)

      expect(actionOf(COMMAND_ID.entry.star)).not.toBeNull()
      expect(actionOf(COMMAND_ID.entry.toggleAISummary)).toBeNull()
      expect(actionOf(COMMAND_ID.entry.readability)).toBeNull()
    },
  )

  test("offers the summary toggle only on a server with AI", async () => {
    setServerConfigs({ ai: false, push: false, registration: false })
    let actionOf = await renderHeader(FeedViewType.Articles)
    expect(actionOf(COMMAND_ID.entry.star)).not.toBeNull()
    expect(actionOf(COMMAND_ID.entry.toggleAISummary)).toBeNull()
    await act(async () => root?.unmount())
    host?.remove()

    setServerConfigs({ ai: true, push: false, registration: false })
    actionOf = await renderHeader(FeedViewType.Articles)
    expect(actionOf(COMMAND_ID.entry.toggleAISummary)).not.toBeNull()
  })
})
