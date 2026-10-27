import { useEntryStore } from "@follow/store/entry/store"
import type { EntryModel } from "@follow/store/entry/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { setServerConfigs } from "~/atoms/server-configs"

import { useTranscription } from "./useTranscription"

const { transcription } = vi.hoisted(() => ({ transcription: vi.fn() }))

vi.mock("~/lib/api-client", () => ({
  followClient: { api: { entries: { transcription } } },
}))

const entry = (attachments: EntryModel["attachments"]): EntryModel => ({
  id: "episode",
  guid: "episode",
  insertedAt: new Date(),
  publishedAt: new Date(),
  attachments,
})

const audio = { url: "https://example.com/episode.mp3", mime_type: "audio/mpeg" }
const subtitles = { url: "https://example.com/episode.srt", mime_type: "text/srt" }

const Probe = () => {
  const { data } = useTranscription("episode")
  return <output>{data ?? ""}</output>
}

describe("useTranscription", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    transcription.mockReset()
  })

  const render = async () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    )
    await act(async () => {})
    return { host, unmount: () => act(async () => root.unmount()) }
  }

  test("asks the server for nothing while it has AI off", async () => {
    setServerConfigs({} as never)
    useEntryStore.setState({ data: { episode: entry([audio]) } })

    const { unmount } = await render()

    expect(transcription).not.toHaveBeenCalled()
    await unmount()
  })

  test("still reads subtitles the feed attached", async () => {
    setServerConfigs({} as never)
    useEntryStore.setState({ data: { episode: entry([audio, subtitles]) } })
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("1\n00:00 --> 00:01"))

    const { host, unmount } = await render()

    await vi.waitFor(() => expect(host.textContent).toContain("00:00"))
    expect(fetch).toHaveBeenCalledWith(subtitles.url)
    expect(transcription).not.toHaveBeenCalled()
    await unmount()
  })
})
