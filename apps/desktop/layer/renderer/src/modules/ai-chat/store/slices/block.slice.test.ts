import { setRoute } from "@follow/components/atoms/route.js"
import { FeedViewType } from "@follow/constants"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"

import { setGeneralSetting } from "~/atoms/settings/general"

import type { FileAttachment } from "../types"
import type { BlockSlice } from "./block.slice"
import { createBlockSlice } from "./block.slice"

vi.mock("~/lib/auth", () => ({}))

const createAttachment = (id: string, serverUrl?: string): FileAttachment => ({
  id,
  name: `${id}.png`,
  type: "image/png",
  size: 1,
  uploadStatus: serverUrl ? "completed" : "processing",
  serverUrl,
})

const showRoute = (params: Record<string, string>) =>
  setRoute({
    params,
    searchParams: new URLSearchParams(),
    location: { pathname: "", search: "", hash: "", state: null, key: "" },
  })

const createBlockActions = () =>
  createStore<BlockSlice>()(createBlockSlice()).getState().blockActions

afterEach(() => {
  showRoute({})
  setGeneralSetting("unreadOnly", false)
})

describe("BlockSliceAction.takeMessageContext", () => {
  it("sends what the user is looking at when the message goes out", () => {
    const blockActions = createBlockActions()

    showRoute({ timelineId: "articles", feedId: "feed-1", entryId: "pending" })
    setGeneralSetting("unreadOnly", true)
    expect(blockActions.takeMessageContext()).toEqual([
      { id: "mainView", type: "mainView", value: `${FeedViewType.Articles}` },
      { id: "mainFeed", type: "mainFeed", value: "feed-1" },
      { id: "unreadOnly", type: "unreadOnly", value: "true" },
    ])

    showRoute({ timelineId: "articles", feedId: "feed-1", entryId: "entry-1" })
    expect(blockActions.takeMessageContext()).toEqual([
      { id: "mainEntry", type: "mainEntry", value: "entry-1" },
    ])

    showRoute({})
    expect(blockActions.takeMessageContext()).toEqual([])
  })

  it("leaves out the context the user removed, until they look at something else", () => {
    const blockActions = createBlockActions()
    showRoute({ timelineId: "articles", feedId: "all", entryId: "entry-1" })

    blockActions.setContextExcluded("entry:entry-1", true)
    expect(blockActions.takeMessageContext()).toEqual([])

    showRoute({ timelineId: "articles", feedId: "all", entryId: "entry-2" })
    expect(blockActions.takeMessageContext()).toEqual([
      { id: "mainEntry", type: "mainEntry", value: "entry-2" },
    ])
  })

  it("sends the uploaded files with the next message only", () => {
    const blockActions = createBlockActions()
    blockActions.addFileAttachment(createAttachment("file-1", "https://files/1.png"))
    blockActions.addFileAttachment(createAttachment("file-2"))
    blockActions.updateFileAttachment("file-2", {
      ...createAttachment("file-2"),
      uploadStatus: "error",
      errorMessage: "upload failed",
    })

    expect(blockActions.takeMessageContext()).toEqual([
      {
        id: "file-1",
        type: "fileAttachment",
        attachment: {
          id: "file-1",
          name: "file-1.png",
          type: "image/png",
          size: 1,
          serverUrl: "https://files/1.png",
        },
      },
    ])
    expect(blockActions.getBlocks()).toEqual([])
  })
})
